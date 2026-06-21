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
      if (!content.includes('ResizeObserver.global.js')) {
        console.log(`Injecting ResizeObserver polyfill into ${fullPath}`);
        content = content.replace('<head>', '<head>\n    <script src="https://unpkg.com/resize-observer-polyfill@1.5.1/dist/ResizeObserver.global.js"></script>');
        fs.writeFileSync(fullPath, content, 'utf8');
      }
    }
  }
}

processDir(path.join(__dirname, 'tv'));
console.log('Done fixing JS bundles.');
