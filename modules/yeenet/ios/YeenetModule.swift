import CommonCrypto
import Darwin
import ExpoModulesCore
import Foundation
import NetworkExtension

// iOS counterpart of the Android module. Same JS API.
// Hotspot joining uses NEHotspotConfiguration (requires the Hotspot Configuration entitlement);
// local network access requires NSLocalNetworkUsageDescription (and the multicast entitlement for SSDP).

private func hexToData(_ hex: String) -> Data {
  var data = Data(capacity: hex.count / 2)
  var i = hex.startIndex
  while i < hex.endIndex {
    let j = hex.index(i, offsetBy: 2)
    data.append(UInt8(hex[i..<j], radix: 16) ?? 0)
    i = j
  }
  return data
}

private func dataToHex(_ data: Data) -> String {
  data.map { String(format: "%02x", $0) }.joined()
}

private func aes(_ op: CCOperation, key: Data, iv: Data, data: Data) throws -> Data {
  var out = Data(count: data.count + kCCBlockSizeAES128)
  var moved = 0
  let outCount = out.count
  let status = out.withUnsafeMutableBytes { o in
    data.withUnsafeBytes { d in
      key.withUnsafeBytes { k in
        iv.withUnsafeBytes { v in
          CCCrypt(op, CCAlgorithm(kCCAlgorithmAES), CCOptions(kCCOptionPKCS7Padding),
                  k.baseAddress, key.count, v.baseAddress, d.baseAddress, data.count,
                  o.baseAddress, outCount, &moved)
        }
      }
    }
  }
  guard status == kCCSuccess else { throw NSError(domain: "Yeenet", code: Int(status)) }
  return out.prefix(moved)
}

private func sockaddrIn(_ host: String, _ port: Int) -> sockaddr_in {
  var a = sockaddr_in()
  a.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
  a.sin_family = sa_family_t(AF_INET)
  a.sin_port = in_port_t(UInt16(port).bigEndian)
  inet_pton(AF_INET, host, &a.sin_addr)
  return a
}

/// Blocking UDP: send `data` to every host, collect replies until timeout.
private func udpExchange(hosts: [String], port: Int, data: Data, timeoutMs: Int, single: Bool,
                         multicast: Bool = false) throws -> [(String, Data)] {
  let fd = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP)
  guard fd >= 0 else { throw NSError(domain: "Yeenet", code: Int(errno)) }
  defer { close(fd) }
  if multicast {
    var ttl: UInt8 = 2
    setsockopt(fd, IPPROTO_IP, IP_MULTICAST_TTL, &ttl, socklen_t(MemoryLayout<UInt8>.size))
  }
  for h in hosts {
    var addr = sockaddrIn(h, port)
    _ = data.withUnsafeBytes { b in
      withUnsafePointer(to: &addr) {
        $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
          sendto(fd, b.baseAddress, data.count, 0, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
        }
      }
    }
  }
  var results: [(String, Data)] = []
  let deadline = Date().addingTimeInterval(Double(timeoutMs) / 1000)
  var buf = [UInt8](repeating: 0, count: 4096)
  while true {
    let left = deadline.timeIntervalSinceNow
    if left <= 0 { break }
    var tv = timeval(tv_sec: Int(left), tv_usec: Int32((left - floor(left)) * 1_000_000))
    setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))
    var from = sockaddr_in()
    var len = socklen_t(MemoryLayout<sockaddr_in>.size)
    let n = withUnsafeMutablePointer(to: &from) {
      $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { recvfrom(fd, &buf, buf.count, 0, $0, &len) }
    }
    if n <= 0 { break }
    var ipBuf = [CChar](repeating: 0, count: Int(INET_ADDRSTRLEN))
    inet_ntop(AF_INET, &from.sin_addr, &ipBuf, socklen_t(INET_ADDRSTRLEN))
    results.append((String(cString: ipBuf), Data(buf[0..<n])))
    if single { break }
  }
  return results
}

private struct Iface {
  let ip: String
  let prefix: Int
}

private func wifiInterface() -> Iface? {
  var ifap: UnsafeMutablePointer<ifaddrs>?
  guard getifaddrs(&ifap) == 0, let first = ifap else { return nil }
  defer { freeifaddrs(ifap) }
  for p in sequence(first: first, next: { $0.pointee.ifa_next }) {
    let i = p.pointee
    guard String(cString: i.ifa_name) == "en0", let a = i.ifa_addr, a.pointee.sa_family == UInt8(AF_INET) else { continue }
    var ip = [CChar](repeating: 0, count: Int(NI_MAXHOST))
    getnameinfo(a, socklen_t(a.pointee.sa_len), &ip, socklen_t(ip.count), nil, 0, NI_NUMERICHOST)
    var prefix = 24
    if let m = i.ifa_netmask {
      let mask = m.withMemoryRebound(to: sockaddr_in.self, capacity: 1) { UInt32(bigEndian: $0.pointee.sin_addr.s_addr) }
      prefix = mask.nonzeroBitCount
    }
    return Iface(ip: String(cString: ip), prefix: prefix)
  }
  return nil
}

private final class TcpConn {
  let fd: Int32
  init(fd: Int32) { self.fd = fd }
}

public class YeenetModule: Module {
  private let queue = DispatchQueue(label: "yeenet", attributes: .concurrent)
  private var conns: [String: TcpConn] = [:]
  private let lock = NSLock()
  private var hotspotPrefix: String?

  public func definition() -> ModuleDefinition {
    Name("Yeenet")

    Events("onTcpLine", "onTcpClose", "onHotspotLost")

    Function("md5") { (hex: String) -> String in
      let d = hexToData(hex)
      var digest = [UInt8](repeating: 0, count: Int(CC_MD5_DIGEST_LENGTH))
      _ = d.withUnsafeBytes { CC_MD5($0.baseAddress, CC_LONG(d.count), &digest) }
      return dataToHex(Data(digest))
    }

    Function("aesEncrypt") { (key: String, iv: String, data: String) throws -> String in
      dataToHex(try aes(CCOperation(kCCEncrypt), key: hexToData(key), iv: hexToData(iv), data: hexToData(data)))
    }

    Function("aesDecrypt") { (key: String, iv: String, data: String) throws -> String in
      dataToHex(try aes(CCOperation(kCCDecrypt), key: hexToData(key), iv: hexToData(iv), data: hexToData(data)))
    }

    AsyncFunction("udpRequest") { (host: String, port: Int, dataHex: String, timeoutMs: Int, _: Bool, promise: Promise) in
      self.queue.async {
        do {
          let r = try udpExchange(hosts: [host], port: port, data: hexToData(dataHex), timeoutMs: timeoutMs, single: true)
          promise.resolve(r.first.map { dataToHex($0.1) })
        } catch {
          promise.reject("UdpError", error.localizedDescription)
        }
      }
    }

    AsyncFunction("udpSweep") { (hosts: [String], port: Int, dataHex: String, timeoutMs: Int, promise: Promise) in
      self.queue.async {
        do {
          let r = try udpExchange(hosts: hosts, port: port, data: hexToData(dataHex), timeoutMs: timeoutMs, single: false)
          promise.resolve(r.map { ["ip": $0.0, "data": dataToHex($0.1)] })
        } catch {
          promise.reject("UdpError", error.localizedDescription)
        }
      }
    }

    AsyncFunction("ssdpSearch") { (timeoutMs: Int, promise: Promise) in
      self.queue.async {
        let msg = "M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1982\r\nMAN: \"ssdp:discover\"\r\nST: wifi_bulb\r\n"
        let r = (try? udpExchange(hosts: ["239.255.255.250"], port: 1982, data: Data(msg.utf8), timeoutMs: timeoutMs,
                                  single: false, multicast: true)) ?? []
        promise.resolve(r.map { ["ip": $0.0, "text": String(decoding: $0.1, as: UTF8.self)] })
      }
    }

    AsyncFunction("tcpOpen") { (id: String, host: String, port: Int, timeoutMs: Int, promise: Promise) in
      self.queue.async {
        self.closeConn(id)
        let fd = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP)
        guard fd >= 0 else { promise.reject("TcpError", "socket"); return }
        var one: Int32 = 1
        setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &one, socklen_t(MemoryLayout<Int32>.size))
        setsockopt(fd, IPPROTO_TCP, TCP_NODELAY, &one, socklen_t(MemoryLayout<Int32>.size))
        // Non-blocking connect with timeout.
        let flags = fcntl(fd, F_GETFL, 0)
        _ = fcntl(fd, F_SETFL, flags | O_NONBLOCK)
        var addr = sockaddrIn(host, port)
        let rc = withUnsafePointer(to: &addr) {
          $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { connect(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) }
        }
        if rc != 0 && errno != EINPROGRESS { close(fd); promise.reject("TcpError", "connect failed"); return }
        var pfd = pollfd(fd: fd, events: Int16(POLLOUT), revents: 0)
        var err: Int32 = 0
        var len = socklen_t(MemoryLayout<Int32>.size)
        if poll(&pfd, 1, Int32(timeoutMs)) <= 0 { close(fd); promise.reject("TcpError", "connect timeout"); return }
        getsockopt(fd, SOL_SOCKET, SO_ERROR, &err, &len)
        if err != 0 { close(fd); promise.reject("TcpError", "connect refused"); return }
        _ = fcntl(fd, F_SETFL, flags)
        let conn = TcpConn(fd: fd)
        self.lock.lock(); self.conns[id] = conn; self.lock.unlock()
        promise.resolve(nil)

        var pending = Data()
        var buf = [UInt8](repeating: 0, count: 4096)
        var error: String? = nil
        while true {
          let n = read(fd, &buf, buf.count)
          if n == 0 { break }
          if n < 0 { error = String(cString: strerror(errno)); break }
          pending.append(contentsOf: buf[0..<n])
          while let nl = pending.firstIndex(of: 0x0A) {
            let line = String(decoding: pending[pending.startIndex..<nl], as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
            pending = Data(pending[(nl + 1)...])
            if !line.isEmpty { self.sendEvent("onTcpLine", ["id": id, "line": line]) }
          }
        }
        self.lock.lock()
        let mine = self.conns[id] === conn
        if mine { self.conns.removeValue(forKey: id) }
        self.lock.unlock()
        if mine {
          close(fd)
          self.sendEvent("onTcpClose", ["id": id, "error": error as Any])
        }
      }
    }

    AsyncFunction("tcpWrite") { (id: String, text: String, promise: Promise) in
      self.lock.lock(); let conn = self.conns[id]; self.lock.unlock()
      guard let c = conn else { promise.reject("TcpClosed", "not connected"); return }
      self.queue.async {
        let d = Data(text.utf8)
        let n = d.withUnsafeBytes { write(c.fd, $0.baseAddress, d.count) }
        if n == d.count { promise.resolve(nil) } else { promise.reject("TcpError", "write failed") }
      }
    }

    Function("tcpClose") { (id: String) in
      self.closeConn(id)
    }
  }

  private func closeConn(_ id: String) {
    lock.lock()
    let c = conns.removeValue(forKey: id)
    lock.unlock()
    if let c = c {
      shutdown(c.fd, SHUT_RDWR)
      close(c.fd)
    }
  }
}
