// Client-side password gate
// To change the password, update the HASH below.
// Generate a new hash: open browser console, run:
//   crypto.subtle.digest('SHA-256', new TextEncoder().encode('yourpassword')).then(b => console.log(Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2,'0')).join('')))

(function () {
  var PASSWORD_HASH = 'd57d60f2eec7b185a385610fefcb511f355994f9a7de235d30dcf456e9b46873'; // engramme2026

  var SESSION_TOKEN = '9a466c08e38ad33b24ac7289fe76a6c678011948bfc37d40e01458f7896f9f54'; // SHA-256 of PASSWORD_HASH
  if (sessionStorage.getItem('site_auth') === SESSION_TOKEN) return;

  var overlay = document.createElement('div');
  overlay.id = 'auth-gate';
  overlay.innerHTML =
    '<div style="background:#fff;border:1px solid #e5e5e5;border-radius:16px;padding:40px;max-width:400px;width:90%;text-align:center">' +
    '<h1 style="font-size:1.5rem;color:#262626;margin-bottom:8px">Engramme Beta Evaluation</h1>' +
    '<p style="font-size:0.875rem;color:#6b6b6b;margin-bottom:24px">Enter the password to access this site.</p>' +
    '<input id="gate-pw" type="password" placeholder="Password" autofocus style="width:100%;padding:12px 16px;border:1px solid #e5e5e5;border-radius:12px;font-size:0.875rem;outline:none;margin-bottom:8px">' +
    '<p id="gate-err" style="color:#dc2626;font-size:0.75rem;margin-bottom:12px;visibility:hidden">Incorrect password. Please try again.</p>' +
    '<button id="gate-btn" style="width:100%;padding:12px;background:#262626;color:#fff;border:none;border-radius:12px;font-size:0.875rem;font-weight:500;cursor:pointer">Enter</button>' +
    '</div>';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#f8f8f8;display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif';

  document.documentElement.appendChild(overlay);

  function check() {
    var pw = document.getElementById('gate-pw').value;
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(pw)).then(function (buf) {
      var hash = Array.from(new Uint8Array(buf)).map(function (x) { return x.toString(16).padStart(2, '0'); }).join('');
      if (hash === PASSWORD_HASH) {
        sessionStorage.setItem('site_auth', SESSION_TOKEN);
        overlay.remove();
      } else {
        document.getElementById('gate-err').style.visibility = 'visible';
        document.getElementById('gate-pw').value = '';
        document.getElementById('gate-pw').focus();
      }
    });
  }

  overlay.querySelector('#gate-btn').addEventListener('click', check);
  overlay.querySelector('#gate-pw').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') check();
  });
})();
