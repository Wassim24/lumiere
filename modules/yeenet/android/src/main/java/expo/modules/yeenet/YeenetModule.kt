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

    // ---------------------------------------------------------------- TCP (line based)

    AsyncFunction("tcpOpen") { id: String, host: String, port: Int, timeoutMs: Int, promise: Promise ->
      io.execute {
        try {
          conns.remove(id)?.let { runCatching { it.socket.close() } }
          val s = Socket()
          s.tcpNoDelay = true
          s.connect(InetSocketAddress(host, port), timeoutMs)
          val conn = TcpConn(s, s.getOutputStream())
          conns[id] = conn
          promise.resolve(null)
          var error: String? = null
          try {
            val reader = BufferedReader(InputStreamReader(s.getInputStream(), Charsets.UTF_8))
            while (true) {
              val line = reader.readLine() ?: break
              if (line.isNotBlank()) sendEvent("onTcpLine", mapOf("id" to id, "line" to line))
            }
          } catch (e: Exception) {
            error = e.message ?: e.toString()
          }
          if (conns.remove(id, conn)) {
            runCatching { s.close() }
            sendEvent("onTcpClose", mapOf("id" to id, "error" to error))
          }
        } catch (e: Exception) {
          promise.reject(CodedException("TcpError", e.message ?: e.toString(), e))
        }
      }
    }

    AsyncFunction("tcpWrite") { id: String, text: String, promise: Promise ->
      val conn = conns[id]
      if (conn == null) {
        promise.reject(CodedException("TcpClosed", "not connected", null))
        return@AsyncFunction
      }
      io.execute {
        try {
          synchronized(conn) {
            conn.out.write(text.toByteArray(Charsets.UTF_8))
            conn.out.flush()
          }
          promise.resolve(null)
        } catch (e: Exception) {
          promise.reject(CodedException("TcpError", e.message ?: e.toString(), e))
        }
      }
    }

    Function("tcpClose") { id: String ->
      conns.remove(id)?.let { runCatching { it.socket.close() } }
      Unit
    }

    // ---------------------------------------------------------------- Wi-Fi

    Function("getWifiInfo") {
      wifiInfo()
    }

    AsyncFunction("scanWifi") { timeoutMs: Int, promise: Promise ->
      val app = context.applicationContext
      val wm = app.getSystemService(Context.WIFI_SERVICE) as WifiManager
      val done = CountDownLatch(1)
      val receiver = object : BroadcastReceiver() {
        override fun onReceive(c: Context, i: Intent) = done.countDown()
      }
      io.execute {
        // startScan is throttled by Android: on timeout, fall back to the cached results.
        try {
          app.registerReceiver(receiver, IntentFilter(WifiManager.SCAN_RESULTS_AVAILABLE_ACTION))
          @Suppress("DEPRECATION")
          if (wm.startScan()) done.await(timeoutMs.toLong(), TimeUnit.MILLISECONDS)
          promise.resolve(scanResults(wm))
        } catch (e: Exception) {
          promise.reject(CodedException("ScanFailed", e.message ?: e.toString(), e))
        } finally {
          runCatching { app.unregisterReceiver(receiver) }
        }
      }
    }

    AsyncFunction("joinHotspot") { prefix: String, timeoutMs: Int, promise: Promise ->
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
        promise.reject(CodedException("Unsupported", "Android 10+ required", null))
        return@AsyncFunction
      }
      releaseHotspotInternal()
      val spec = WifiNetworkSpecifier.Builder()
        .setSsidPattern(PatternMatcher(prefix, PatternMatcher.PATTERN_PREFIX))
        .build()
      val request = NetworkRequest.Builder()
        .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
        .removeCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
        .setNetworkSpecifier(spec)
        .build()
      var settled = false
      val cb = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
          hotspot = network
        }

        override fun onLinkPropertiesChanged(network: Network, lp: LinkProperties) {
          if (settled) return
          val gw = gatewayOf(lp) ?: return
          settled = true
          hotspot = network
          val caps = cm.getNetworkCapabilities(network)
          val ssid = (caps?.transportInfo as? WifiInfo)?.ssid?.trim('"')
          promise.resolve(mapOf("gateway" to gw, "ssid" to ssid))
        }

        override fun onUnavailable() {
          if (settled) return
          settled = true
          hotspotCallback = null
          promise.reject(CodedException("HotspotNotJoined", "hotspot not joined", null))
        }

        override fun onLost(network: Network) {
          if (hotspot == network) {
            hotspot = null
            sendEvent("onHotspotLost", mapOf<String, Any>())
          }
        }
      }
      hotspotCallback = cb
      try {
        cm.requestNetwork(request, cb, timeoutMs)
      } catch (e: Exception) {
        hotspotCallback = null
        promise.reject(CodedException("HotspotNotJoined", e.message ?: e.toString(), e))
      }
    }

    Function("releaseHotspot") {
      releaseHotspotInternal()
    }
  }

  private fun releaseHotspotInternal() {
    hotspotCallback?.let { runCatching { cm.unregisterNetworkCallback(it) } }
    hotspotCallback = null
    hotspot = null
    runCatching { cm.bindProcessToNetwork(null) }
  }

  private fun gatewayOf(lp: LinkProperties): String? {
    for (r in lp.routes) {
      val gw = r.gateway
      if (r.isDefaultRoute && gw is Inet4Address && !gw.isAnyLocalAddress) return gw.hostAddress
    }
    for (r in lp.routes) {
      val gw = r.gateway
      if (gw is Inet4Address && !gw.isAnyLocalAddress) return gw.hostAddress
    }
    return null
  }

  @SuppressLint("MissingPermission")
  @Suppress("DEPRECATION")
  private fun scanResults(wm: WifiManager): List<Map<String, Any>> =
    wm.scanResults.orEmpty().filter { !it.SSID.isNullOrBlank() }.map {
      mapOf("ssid" to it.SSID, "frequency" to it.frequency, "level" to it.level)
    }

  @SuppressLint("MissingPermission")
  private fun wifiInfo(): Map<String, Any?> {
    val net = cm.activeNetwork
    val caps = net?.let { cm.getNetworkCapabilities(it) }
    val isWifi = caps?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true
    val lp = net?.let { cm.getLinkProperties(it) }
    val v4 = lp?.linkAddresses?.firstOrNull { it.address is Inet4Address }
    var ssid: String? = null
    var freq: Int? = null
    if (isWifi) {
      val wi = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) caps?.transportInfo as? WifiInfo else null
      @Suppress("DEPRECATION")
      val legacy = (context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager).connectionInfo
      fun clean(s: String?) = s?.trim('"')?.takeUnless { it == "<unknown ssid>" || it.isBlank() }
      ssid = clean(wi?.ssid) ?: clean(legacy?.ssid)
      freq = wi?.frequency ?: legacy?.frequency
    }
    return mapOf(
      "isWifi" to isWifi,
      "ssid" to ssid,
      "frequency" to freq,
      "ip" to v4?.address?.hostAddress,
      "prefixLength" to v4?.prefixLength,
      "gateway" to lp?.let { gatewayOf(it) },
    )
  }
}
