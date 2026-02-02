# Jarvis Dashboard 🦊

Real-time activity dashboard for Jarvis AI assistant.

## Features
- Live status indicator (active/idle)
- Activity calendar (week/month views)
- Stats and charts
- Chat panel for activity discussions
- GitHub repos overview
- Mobile responsive

## Setup
```bash
npm install
node server.js
```

## HTTPS
Generate self-signed cert:
```bash
openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 365 -nodes
```
