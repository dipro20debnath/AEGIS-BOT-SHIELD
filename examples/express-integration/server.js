const express = require('express');
const bodyParser = require('body-parser');
// In a real project, this would be require('@aegis-bot-shield/node')
const aegisExpress = require('../../packages/aegis-node').aegisExpress;

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to parse JSON and URL-encoded bodies
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Serve static HTML for testing
app.use(express.static('../html-basic'));

// Configure AEGIS Middleware
const aegisMiddleware = aegisExpress({
    secretKey: process.env.AEGIS_SECRET_KEY || 'default-dev-secret-key',
    blockMode: true, // Automatically return 403 for bots
    logLevel: 'debug',
    onBotDetected: (req, res, score) => {
        console.warn(`[AEGIS] Bot detected on ${req.path}. Score: ${score}`);
        // Custom logic can go here (e.g., triggering an alert)
    }
});

// Protect a specific route
app.post('/api/login', aegisMiddleware, (req, res) => {
    const { username, password } = req.body;
    
    // If execution reaches here, AEGIS has determined the request is human
    console.log(`Login attempt for user: ${username}`);
    
    if (username === 'admin' && password === 'password') {
        res.json({ success: true, message: 'Welcome, human!' });
    } else {
        res.status(401).json({ success: false, message: 'Invalid credentials.' });
    }
});

// A protected API endpoint returning sensitive data
app.get('/api/sensitive-data', aegisMiddleware, (req, res) => {
    res.json({ data: 'This is protected data. Bots cannot see this.' });
});

app.listen(PORT, () => {
    console.log(`AEGIS Express Example running on http://localhost:${PORT}`);
});
