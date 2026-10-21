package expo.modules.yeenet

import android.annotation.SuppressLint
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.ConnectivityManager
import android.net.LinkProperties
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.wifi.WifiInfo
import android.net.wifi.WifiManager
import android.net.wifi.WifiNetworkSpecifier
import android.os.Build
import android.os.PatternMatcher
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStream
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.MulticastSocket
import java.net.Socket
import java.net.SocketTimeoutException
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import javax.crypto.Cipher
import javax.crypto.spec.IvParameterSpec
import javax.crypto.spec.SecretKeySpec

private fun String.hexToBytes(): ByteArray =
  ByteArray(length / 2) { i -> substring(i * 2, i * 2 + 2).toInt(16).toByte() }

private fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it) }

private class TcpConn(val socket: Socket, val out: OutputStream)

class YeenetModule : Module() {
  private val io = Executors.newCachedThreadPool()
  private val conns = ConcurrentHashMap<String, TcpConn>()
  private var hotspot: Network? = null
  private var hotspotCallback: ConnectivityManager.NetworkCallback? = null

  private val context: Context
    get() = appContext.reactContext ?: throw CodedException("NoContext", "No React context", null)

  private val cm: ConnectivityManager
    get() = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager

  override fun definition() = ModuleDefinition {
    Name("Yeenet")

    Events("onTcpLine", "onTcpClose", "onHotspotLost")

    OnDestroy {
      conns.values.forEach { runCatching { it.socket.close() } }
      conns.clear()
      releaseHotspotInternal()
      io.shutdownNow()
    }

    // ---------------------------------------------------------------- crypto

    Function("md5") { hex: String ->
      MessageDigest.getInstance("MD5").digest(hex.hexToBytes()).toHex()
    }

    Function("aesEncrypt") { keyHex: String, ivHex: String, dataHex: String ->
      val c = Cipher.getInstance("AES/CBC/PKCS5Padding")
      c.init(Cipher.ENCRYPT_MODE, SecretKeySpec(keyHex.hexToBytes(), "AES"), IvParameterSpec(ivHex.hexToBytes()))
      c.doFinal(dataHex.hexToBytes()).toHex()
    }

    Function("aesDecrypt") { keyHex: String, ivHex: String, dataHex: String ->
      val c = Cipher.getInstance("AES/CBC/PKCS5Padding")
      c.init(Cipher.DECRYPT_MODE, SecretKeySpec(keyHex.hexToBytes(), "AES"), IvParameterSpec(ivHex.hexToBytes()))
      c.doFinal(dataHex.hexToBytes()).toHex()
    }

    // ---------------------------------------------------------------- UDP

    // Send one datagram, wait for one reply. Resolves null on timeout.
    AsyncFunction("udpRequest") { host: String, port: Int, dataHex: String, timeoutMs: Int, onHotspot: Boolean, promise: Promise ->
      io.execute {
        try {
          DatagramSocket().use { s ->
            if (onHotspot) (hotspot ?: throw IllegalStateException("hotspot not joined")).bindSocket(s)
            s.soTimeout = timeoutMs
            val data = dataHex.hexToBytes()
            s.send(DatagramPacket(data, data.size, InetAddress.getByName(host), port))
            val buf = ByteArray(4096)
            val p = DatagramPacket(buf, buf.size)
            try {
              s.receive(p)
              promise.resolve(buf.copyOf(p.length).toHex())
            } catch (e: SocketTimeoutException) {
              promise.resolve(null)
            }
          }
        } catch (e: Exception) {
          promise.reject(CodedException("UdpError", e.message ?: e.toString(), e))
        }
      }
    }

    // Send the same datagram to every host and collect all replies until timeout. Hosts are split in
    // groups with one socket each: a single socket bursting to 250 unresolved neighbours fills its
    // send buffer and silently drops datagrams.
    AsyncFunction("udpSweep") { hosts: List<String>, port: Int, dataHex: String, timeoutMs: Int, promise: Promise ->
      io.execute {
        try {
          val data = dataHex.hexToBytes()
          val results = java.util.Collections.synchronizedList(mutableListOf<Map<String, String>>())
          val groups = hosts.chunked(16)
          val done = java.util.concurrent.CountDownLatch(groups.size)
          for (group in groups) {
            io.execute {
              try {
                DatagramSocket().use { s ->
                  for (h in group) {
                    runCatching { s.send(DatagramPacket(data, data.size, InetAddress.getByName(h), port)) }
                  }
                  val deadline = System.currentTimeMillis() + timeoutMs
                  val buf = ByteArray(4096)
                  while (true) {
                    val left = deadline - System.currentTimeMillis()
                    if (left <= 0) break
                    s.soTimeout = left.toInt()
                    val p = DatagramPacket(buf, buf.size)
                    try {
                      s.receive(p)
                    } catch (e: SocketTimeoutException) {
                      break
                    }
                    results.add(mapOf("ip" to (p.address.hostAddress ?: ""), "data" to buf.copyOf(p.length).toHex()))
                  }
                }
              } catch (_: Exception) {
              } finally {
                done.countDown()
              }
            }
          }
          done.await()
          promise.resolve(results.toList())
        } catch (e: Exception) {
          promise.reject(CodedException("UdpError", e.message ?: e.toString(), e))
        }
      }
    }

    // Yeelight SSDP M-SEARCH on 239.255.255.250:1982; returns raw responses.
    AsyncFunction("ssdpSearch") { timeoutMs: Int, promise: Promise ->
      io.execute {
        val wm = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
        val lock = wm.createMulticastLock("lumiere-ssdp").apply { setReferenceCounted(false) }
        try {
          lock.acquire()
          MulticastSocket(null).use { s ->
            s.reuseAddress = true
            s.bind(InetSocketAddress(0))
            val msg = "M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1982\r\nMAN: \"ssdp:discover\"\r\nST: wifi_bulb\r\n".toByteArray()
            val group = InetAddress.getByName("239.255.255.250")
            repeat(2) { s.send(DatagramPacket(msg, msg.size, group, 1982)) }
            val results = mutableListOf<Map<String, String>>()
            val deadline = System.currentTimeMillis() + timeoutMs
            val buf = ByteArray(4096)
            while (true) {
              val left = deadline - System.currentTimeMillis()
              if (left <= 0) break
              s.soTimeout = left.toInt()
              val p = DatagramPacket(buf, buf.size)
              try {
                s.receive(p)
              } catch (e: SocketTimeoutException) {
                break
              }
              results.add(mapOf("ip" to (p.address.hostAddress ?: ""), "text" to String(buf, 0, p.length)))
            }
            promise.resolve(results)
          }
        } catch (e: Exception) {
          promise.reject(CodedException("SsdpError", e.message ?: e.toString(), e))
        } finally {
          runCatching { lock.release() }
        }
      }
    }

  }

  private fun releaseHotspotInternal() {
    hotspotCallback?.let { runCatching { cm.unregisterNetworkCallback(it) } }
    hotspotCallback = null
    hotspot = null
    runCatching { cm.bindProcessToNetwork(null) }
  }
}
