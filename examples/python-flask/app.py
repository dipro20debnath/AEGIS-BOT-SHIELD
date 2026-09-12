from flask import Flask, request, jsonify

app = Flask(__name__)

# Mock AEGIS Middleware for example purposes
class AegisMiddleware:
    def __init__(self, app, api_key, mode='monitor'):
        self.app = app
        self.api_key = api_key
        self.mode = mode

    def __call__(self, environ, start_response):
        path = environ.get('PATH_INFO', '')
        print(f"[AEGIS] Analyzing request to {path}")
        # In a real scenario, we would block or allow the request here based on AEGIS analysis.
        return self.app(environ, start_response)

# Apply AEGIS protection
app.wsgi_app = AegisMiddleware(app.wsgi_app, api_key='EXAMPLE_KEY_123', mode='enforce')

@app.route('/')
def home():
    return "<h1>AEGIS Protected Flask App</h1><p>Protected by AEGIS BOT SHIELD.</p><a href='/login'>Go to Login</a>"

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        return jsonify({"success": True, "message": "Logged in securely (Request analyzed by AEGIS)"})
    
    return """
        <h1>Login</h1>
        <form action="/login" method="POST">
            <input type="text" name="username" placeholder="Username" /><br/>
            <input type="password" name="password" placeholder="Password" /><br/>
            <button type="submit">Login</button>
        </form>
    """

if __name__ == '__main__':
    app.run(port=5000)
