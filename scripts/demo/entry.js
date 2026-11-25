import './fixture.js';
import '../../src/web/main.tsx';
import './banner.css';

// The real settings page is visible, but credentials cannot be entered in a demo.
function lockPrivateControls() {
  for (const control of document.querySelectorAll('.settings-card form input, .settings-card form button, .topbar .text-button')) {
    control.disabled = true;
  }
  const automation = document.querySelector('section.rule-editor > form');
  if (automation) {
    for (const control of automation.querySelectorAll('fieldset, button')) control.disabled = true;
    const prepare = document.querySelector('.rule-preview .section-heading button');
    if (prepare) prepare.disabled = true;
  }
}
new MutationObserver(lockPrivateControls).observe(document.getElementById('root'), { childList: true, subtree: true });
