"""Loopback-only synthetic gateway for isolated Zotero integration tests."""
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

class Gateway(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        url = urlparse(self.path)
        if url.path != '/v1/models' or not parse_qs(url.query).get('client_version'):
            self.send_error(400, 'client_version required')
            return
        self.respond(json.dumps({'models': [{'slug': 'synthetic-codex'}]}).encode(), 'application/json')

    def respond(self, data, content_type=None):
        self.send_response(200)
        if content_type:
            self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        if self.path != '/v1/responses' or body.get('stream') is not True or body.get('store') is not False or 'temperature' in body or 'max_output_tokens' in body:
            self.send_error(400, 'invalid Codex request')
            return
        events = [{'type': 'response.created', 'response': {'id': 'resp_synthetic', 'store': False}}]
        if body.get('tools') and not any(i.get('type') == 'function_call_output' for i in body['input']):
            item = {'type': 'function_call', 'id': 'fc_synthetic', 'call_id': 'call_synthetic', 'name': 'read_paper', 'arguments': '{}'}
            events.append({'type': 'response.output_item.added', 'output_index': 0, 'item': item})
        else:
            item = {'type': 'message', 'id': 'msg_synthetic', 'role': 'assistant', 'phase': 'final_answer', 'content': [{'type': 'output_text', 'text': '降雨预报：两小时。'}]}
            events.append({'type': 'response.output_text.delta', 'delta': '降雨预报：两小时。'})
        events.extend([
            {'type': 'response.output_item.done', 'output_index': 0, 'item': item},
            {'type': 'response.completed', 'response': {'id': 'resp_synthetic', 'status': 'completed', 'output': []}},
        ])
        # Deliberately omit Content-Type, matching observed gateway diagnostics.
        self.respond(''.join('data: '+json.dumps(e)+'\n\n' for e in events).encode())

if __name__ == '__main__':
    server = ThreadingHTTPServer(('127.0.0.1', 18741), Gateway)
    print('Synthetic Codex gateway listening on 127.0.0.1:18741', flush=True)
    server.serve_forever()
