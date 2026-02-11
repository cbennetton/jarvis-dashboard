const express = require('express');
const https = require('https');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');

// Call me now endpoint
router.post('/', requireAuth, async (req, res) => {
  const phoneNumber = '+4915164506619'; // Christopher's phone number
  
  console.log('📞 Initiating call to', phoneNumber);
  
  // Call via OpenClaw Gateway API
  const payload = JSON.stringify({
    method: 'voicecall.initiate',
    params: {
      to: phoneNumber,
      message: 'Hi Christopher! You clicked the Call Me Now button on the dashboard. Ready to talk!',
      mode: 'conversation'
    }
  });
  
  const options = {
    hostname: '127.0.0.1',
    port: 18789,
    path: '/rpc',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': payload.length,
      'Authorization': 'Bearer 6444179f636ff5a7a1818db88b90e0e253d32dfa1a42e23b'
    },
    rejectUnauthorized: false
  };
  
  const gatewayReq = https.request(options, (gatewayRes) => {
    let data = '';
    gatewayRes.on('data', (chunk) => { data += chunk; });
    gatewayRes.on('end', () => {
      try {
        const result = JSON.parse(data);
        if (result.error) {
          console.error('Gateway error:', result.error);
          return res.status(500).json({ success: false, error: result.error });
        }
        console.log('Call initiated:', result);
        res.json({ success: true, callId: result.result?.callId });
      } catch (e) {
        console.error('Parse error:', e);
        res.status(500).json({ success: false, error: 'Failed to parse gateway response' });
      }
    });
  });
  
  gatewayReq.on('error', (error) => {
    console.error('Gateway request error:', error);
    res.status(500).json({ success: false, error: error.message });
  });
  
  gatewayReq.write(payload);
  gatewayReq.end();
});

module.exports = router;
