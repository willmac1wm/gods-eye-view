/**
 * External share helper for /incidents/{id} pages (keeps BROWSER_CSP free of unsafe-inline).
 */
const shareBtn = document.getElementById('btn-share-incident');
if (shareBtn) {
  shareBtn.addEventListener('click', async () => {
    const shareUrl = document.body?.dataset?.shareUrl || window.location.href;
    const shareTitle = document.body?.dataset?.shareTitle || document.title;
    try {
      if (navigator.share) {
        await navigator.share({ title: shareTitle, url: shareUrl });
        return;
      }
    } catch {
      /* fall back to clipboard */
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      const original = shareBtn.textContent;
      shareBtn.textContent = 'Link Copied!';
      setTimeout(() => {
        shareBtn.textContent = original;
      }, 2000);
    } catch {
      window.prompt('Copy incident link:', shareUrl);
    }
  });
}
