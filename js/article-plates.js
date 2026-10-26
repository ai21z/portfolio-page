// A post's video rests in its plate with one play stamp in the chrome's ring, instead of the browser's
// control bar. The controls come back once it plays. Without scripts the video keeps its own controls.
export function initPlates(root) {
  for (const video of root.querySelectorAll('.article-plate video')) {
    const plate = video.closest('.article-plate');
    if (plate.querySelector('.plate-play')) continue;
    video.controls = false;
    const play = document.createElement('button');
    play.type = 'button';
    play.className = 'plate-play';
    play.setAttribute('aria-label', 'Play the video');
    play.addEventListener('click', () => {
      video.controls = true;
      play.remove();
      video.focus();
      video.play().catch(() => {});
    });
    plate.append(play);
  }
}

// The post page runs it here; the Blog reader runs it on each post it opens (js/app.js).
if (document.querySelector('main.article-container')) initPlates(document);
