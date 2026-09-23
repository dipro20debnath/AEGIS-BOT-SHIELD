import os
from flask import Flask, request, jsonify, render_template_string
# In a real project: from aegis_python.flask import AegisMiddleware
import sys
sys.path.append('../../packages/aegis-python')
from aegis_flask import AegisMiddleware

app = Flask(__name__)

# Configure AEGIS Middleware
aegis = AegisMiddleware(
    app,
    secret_key=os.environ.get('AEGIS_SECRET_KEY', 'dev-secret-key-123'),
    action_on_bot='block', # Can be 'block', 'monitor', or 'challenge'
    exempt_routes=['/health', '/static/']
)

@app.route('/')
def index():
    return "AEGIS BOT SHIELD Flask Example. Try POSTing to /login."

@app.route('/health')
def health():
    # This route is exempt from AEGIS checks
    return jsonify({"status": "healthy"})

@app.route('/login', methods=['POST'])
@aegis.protect() # Protect specific route
def login():
    data = request.get_json() or request.form
    username = data.get('username')
    password = data.get('password')

    # If the request reaches this function, AEGIS has cleared it as human
    if username == 'admin' and password == 'password':
        return jsonify({"success": True, "message": "Login successful. Human verified."})
    
    return jsonify({"success": False, "message": "Invalid credentials."}), 401

@app.route('/api/data', methods=['GET'])
@aegis.protect()
def sensitive_data():
    return jsonify({"data": "This is sensitive data protected by AEGIS ML Engine."})

if __name__ == '__main__':
    print("Starting Flask server with AEGIS protection on port 5000...")
    app.run(debug=True, port=5000)
