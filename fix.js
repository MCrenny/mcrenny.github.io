const fs = require('fs');
const path = require('path');

function processDir(dir) {
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir);

  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      processDir(fullPath);
    } else if (fullPath.endsWith('.js')) {
      let content = fs.readFileSync(fullPath, 'utf8');
      if (content.includes('({env:{MODE:"production"},url:window.location.href})')) {
        console.log(`Fixing ({env:{MODE:"production"},url:window.location.href}) in ${fullPath}`);
        content = content.replace(/import\.meta\.env/g, '({MODE:"production"})');
        content = content.replace(/import\.meta/g, '({env:{MODE:"production"},url:window.location.href})');
        fs.writeFileSync(fullPath, content, 'utf8');
      }
    } else if (file === 'index.html') {
      let content = fs.readFileSync(fullPath, 'utf8');
      if (!content.includes('globalThis =')) {
        console.log(`Injecting extra polyfills into ${fullPath}`);
        const polyfills = `
    <script>
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
    <script src="https://unpkg.com/resize-observer-polyfill@1.5.1/dist/ResizeObserver.global.js"></script>`;
        content = content.replace(/<script src="https:\/\/unpkg.com\/resize-observer-polyfill[^>]+><\/script>/g, ''); // Clean up old duplicate if any
        content = content.replace('<head>', '<head>' + polyfills);
        fs.writeFileSync(fullPath, content, 'utf8');
      }
    }
  }
}

processDir(path.join(__dirname));
console.log('Done fixing JS bundles and injecting polyfills.');
