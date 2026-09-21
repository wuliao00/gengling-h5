"""局域网开发服务器：禁用缓存，供手机浏览器实时加载最新代码。

必须用 ThreadingHTTPServer：页面启动时浏览器会并发拉十几个 ES 模块，
单线程 TCPServer 一次只处理一个请求，排队超时的连接会被直接拒绝，
表现为 ERR_CONNECTION_REFUSED —— 页面白屏且没有任何 JS 报错，极难定位。
"""
import http.server
import socketserver
import os
import sys

os.chdir(os.path.dirname(os.path.abspath(__file__)))

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, fmt, *args):
        print('[http]', fmt % args)

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8081

class Server(http.server.ThreadingHTTPServer):
    daemon_threads = True          # 请求线程随进程退出，不因半开连接挂住关闭
    allow_reuse_address = True
    # 光换 ThreadingHTTPServer 还不够：基类 request_queue_size 只有 5，
    # 页面启动时十几个模块几乎同时到达，backlog 一溢出就是 ERR_CONNECTION_REFUSED。
    request_queue_size = 128

with Server(('0.0.0.0', port), Handler) as httpd:
    print(f'serving on 0.0.0.0:{port} (threaded, backlog={Server.request_queue_size})')
    httpd.serve_forever()

