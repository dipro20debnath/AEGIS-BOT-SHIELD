# Integration Guide

This guide will walk you through integrating AEGIS BOT SHIELD into your application stack.

## Quick Start (5 Minutes)

The fastest way to protect a form is using the CDN-hosted JS SDK and our cloud verification API.

1. Include the script in your HTML:
```html
<script src="https://cdn.aegis-shield.com/v1/aegis.js"></script>
```

2. Initialize the client:
```javascript
const aegis = new AegisClient({ siteKey: 'YOUR_SITE_KEY' });
aegis.init();
```

3. Attach the token to your form submission:
```javascript
document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const token = await aegis.getToken();
    document.getElementById('aegis_token').value = token;
    e.target.submit();
});
```

## Express.js Integration

Install the package:
`npm install @aegis/node`

Configure your app:
```javascript
const express = require('express');
const { aegisExpress } = require('@aegis/node');

const app = express();

// Apply globally or to specific routes
app.post('/api/login', aegisExpress({
    secretKey: process.env.AEGIS_SECRET,
    mode: 'block' // 'block', 'monitor', or 'challenge'
}), (req, res) => {
    res.send('Login successful');
});
```

## Django Integration

Install the package:
`pip install aegis-python`

Add to `settings.py`:
```python
MIDDLEWARE = [
    # ... other middleware ...
    'aegis_python.django.AegisMiddleware',
]

AEGIS_CONFIG = {
    'SECRET_KEY': 'your-secret-key',
    'MODE': 'block'
}
```

## FastAPI Integration

```python
from fastapi import FastAPI
from aegis_python.fastapi import AegisMiddleware

app = FastAPI()

app.add_middleware(
    AegisMiddleware,
    secret_key="your-secret-key"
)
```

## React Integration

For SPAs, we provide a React hook:

```javascript
import { useAegis } from '@aegis/react';

function LoginForm() {
    const { getToken, isReady } = useAegis('YOUR_SITE_KEY');

    const handleSubmit = async () => {
        const token = await getToken();
        // Send token to your backend...
    };
    
    return (
        <button disabled={!isReady} onClick={handleSubmit}>Login</button>
    );
}
```

## Custom Rules

You can define custom rules in your backend initialization to tailor the defense to your specific threat model:

```javascript
aegis.addRule({
    name: 'block_tor_nodes',
    condition: (req) => req.isTorExitNode === true,
    action: 'BLOCK'
});
```
