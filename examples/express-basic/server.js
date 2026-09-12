const express = require('express');
const app = express();
const port = 3000;

// Mock AEGIS Middleware for example purposes
const aegisMiddleware = (config) => {
    return (req, res, next) => {
        console.log(`[AEGIS] Analyzing request to ${req.path}`);
        // Simulate analysis
        next();
    };
};

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Apply AEGIS protection
app.use(aegisMiddleware({
    apiKey: 'EXAMPLE_KEY_123',
    mode: 'enforce'
}));

app.get('/', (req, res) => {
    res.send(`
        <h1>AEGIS Protected Express App</h1>
        <p>This application is protected by AEGIS BOT SHIELD.</p>
        <a href="/login">Go to Login</a>
    `);
});

app.get('/login', (req, res) => {
    res.send(`
        <h1>Login</h1>
        <form action="/api/login" method="POST">
            <input type="text" name="username" placeholder="Username" /><br/>
            <input type="password" name="password" placeholder="Password" /><br/>
            <button type="submit">Login</button>
        </form>
    `);
});

app.post('/api/login', (req, res) => {
    // AEGIS will have already analyzed this POST request
    res.json({ success: true, message: "Logged in successfully (Request analyzed by AEGIS)" });
});

app.listen(port, () => {
    console.log(\`Example app listening at http://localhost:\${port}\`);
});
