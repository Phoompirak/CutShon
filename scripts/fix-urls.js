const fs = require('fs');
const p = 'public/js/app.js';
let c = fs.readFileSync(p, 'utf8');

c = `// Added API_BASE logic
let API_BASE = '';
window.addEventListener('DOMContentLoaded', async () => {
    if (window.location.protocol === 'tauri:') {
        let found = false;
        for (let port = 3000; port < 3010; port++) {
            try {
                const url = \`http://127.0.0.1:\${port}\`;
                const r = await fetch(\`\${url}/api/ping\`);
                if (r.ok) { API_BASE = url; found = true; break; }
            } catch(e) {}
        }
        if (!found && typeof showError === 'function') {
            showError({
                title: 'Connection Failed',
                subtitle: 'Cannot connect to background server',
                message: 'The local API server failed to start or is blocked by a firewall. Please check the log files located in %LocalAppData%\\\\CutShon\\\\logs.',
                details: 'Ports 3000-3009 were scanned but no response was received.'
            });
        }
    }
});

` + c;

c = c.replace(/fetch\((['"`])\/api\//g, "fetch(API_BASE + $1/api/");
c = c.replace(/EventSource\((['"`])\/api\//g, "EventSource(API_BASE + $1/api/");
c = c.replace(/fetch\(\`\/api\//g, "fetch(`${API_BASE}/api/");
c = c.replace(/EventSource\(\`\/api\//g, "EventSource(`${API_BASE}/api/");
fs.writeFileSync(p, c);
