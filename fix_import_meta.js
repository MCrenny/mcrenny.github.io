const fs = require('fs');
const path = require('path');

function processDir(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      processDir(fullPath);
    } else if (fullPath.endsWith('.js')) {
      let content = fs.readFileSync(fullPath, 'utf8');
      if (content.includes('import.meta.env')) {
        console.log(`Fixing import.meta.env in ${fullPath}`);
        content = content.replace(/import\.meta\.env/g, '({MODE:"production"})');
        fs.writeFileSync(fullPath, content, 'utf8');
      }
      if (content.includes('import.meta')) {
        console.log(`Fixing remaining import.meta in ${fullPath}`);
        content = content.replace(/import\.meta/g, '({env:{MODE:"production"},url:window.location.href})');
        fs.writeFileSync(fullPath, content, 'utf8');
      }
    } else if (file === 'index.html') {
      let content = fs.readFileSync(fullPath, 'utf8');
      if (!content.includes('tv-debug-err')) {
        console.log(`Injecting debug overlay and polyfills into ${fullPath}`);
        const polyfills = `
    <script>
      window.onerror = function(message, source, lineno, colno, error) {
        var errContainer = document.getElementById('tv-debug-err');
        if (!errContainer) {
          errContainer = document.createElement('div');
          errContainer.id = 'tv-debug-err';
          errContainer.style.position = 'fixed';
          errContainer.style.top = '0';
          errContainer.style.left = '0';
          errContainer.style.width = '100%';
          errContainer.style.height = '100%';
          errContainer.style.backgroundColor = 'rgba(0,0,0,0.95)';
          errContainer.style.color = '#ff3b30';
          errContainer.style.padding = '25px';
          errContainer.style.zIndex = '9999999';
          errContainer.style.fontSize = '16px';
          errContainer.style.fontFamily = 'monospace';
          errContainer.style.overflow = 'auto';
          errContainer.style.boxSizing = 'border-box';
          document.body.appendChild(errContainer);
        }
        errContainer.innerHTML = '<h1 style="color: #ffcc00; font-size: 24px; margin-bottom: 15px;">⚠️ JS Crash Caught</h1>' +
          '<p><strong>Error:</strong> ' + message + '</p>' +
          '<p><strong>File:</strong> ' + source + ' : ' + lineno + ':' + colno + '</p>' +
          '<pre style="background: #2c2c2e; color: #fff; padding: 15px; border-radius: 8px; margin-top: 15px; white-space: pre-wrap; font-size: 14px;">' + 
          (error && error.stack ? error.stack : 'No stack trace available') + '</pre>';
        
        try {
          var xhr = new XMLHttpRequest();
          xhr.open('POST', '/api/tv-log', true);
          xhr.setRequestHeader('Content-Type', 'application/json');
          xhr.send(JSON.stringify({
            message: message,
            source: source,
            lineno: lineno,
            colno: colno,
            stack: error && error.stack ? error.stack : null
          }));
        } catch(e) {}
        return false;
      };

      if (typeof globalThis === 'undefined') {
        Object.defineProperty(Object.prototype, '__magic__', {
            get: function() { return this; },
            configurable: true
        });
        __magic__.globalThis = __magic__;
        delete Object.prototype.__magic__;
      }
      if (typeof queueMicrotask === 'undefined') {
        window.queueMicrotask = function(callback) {
          Promise.resolve().then(callback).catch(function(e){setTimeout(function(){throw e;})});
        };
      }
    </script>
    <script type="text/javascript" src="https://msx.benzac.de/js/tvx-plugin.min.js"></script>
    <script src="https://unpkg.com/resize-observer-polyfill@1.5.1/dist/ResizeObserver.global.js"></script>`;
        
        // Clean up any old polyfill script tags if they exist to avoid duplicates
        content = content.replace(/<script>[\s\S]*?globalThis[\s\S]*?<\/script>/g, '');
        content = content.replace(/<script src="https:\/\/unpkg.com\/resize-observer-polyfill[^>]+><\/script>/g, '');
        
        content = content.replace('<head>', '<head>' + polyfills);
        fs.writeFileSync(fullPath, content, 'utf8');
      }
    }
  }
}

processDir(path.join(__dirname, 'tv'));
console.log('Done fixing JS bundles.');
