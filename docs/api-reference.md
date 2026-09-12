# API Reference

## Base URL
`https://api.aegisbotshield.com/v1`

## Authentication
All API requests require an `X-AEGIS-API-KEY` header.

## Endpoints

### Analyze Request
`POST /analyze`

Analyzes request metadata and returns a risk score.

**Request:**
```json
{
  "ip": "192.168.1.1",
  "userAgent": "Mozilla/5.0...",
  "headers": {},
  "path": "/login"
}
```

**Response:**
```json
{
  "riskScore": 0.85,
  "action": "block",
  "reason": "high_velocity_login"
}
```

### Get Threats
`GET /threats`

Returns recent threat data for the dashboard.
