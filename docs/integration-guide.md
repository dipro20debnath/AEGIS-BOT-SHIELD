# Integration Guide

## JavaScript SDK (Frontend)
Include the tracking script in your application's `<head>`. This script handles Layer 2 and Layer 3 data collection.

```html
<script src="https://cdn.aegis.com/sdk.js" data-aegis-key="YOUR_API_KEY"></script>
```

## Node.js / Express
Use the `@aegis/shield` package to protect your backend routes.

```javascript
const { aegisMiddleware } = require('@aegis/shield');
app.use(aegisMiddleware({ apiKey: 'YOUR_KEY' }));
```

## Python / Flask
Use the `aegis-shield` package.

```python
from aegis_shield import AegisMiddleware
app.wsgi_app = AegisMiddleware(app.wsgi_app, api_key='YOUR_KEY')
```
