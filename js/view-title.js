// Each view names the browser tab after what it shows. The landing keeps the title search engines index.

const SITE_NAME = 'Aris Zounarakis';
const LANDING_TITLE = document.title;
const SECTION_NAMES = { about: 'About', skills: 'Skills', work: 'Work', blog: 'Blog', contact: 'Contact' };

function blogTitle() {
  const articleView = document.getElementById('blog-article-view');
  if (articleView && !articleView.hidden && articleView.dataset.title) return articleView.dataset.title;
  const categoryView = document.getElementById('blog-category-view');
  const name = categoryView && !categoryView.hidden ? categoryView.dataset.categoryName : '';
  return name ? `${name} | Blog | ${SITE_NAME}` : `Blog | ${SITE_NAME}`;
}

// Reads the view from the page itself, so every route (a click, Back, a deep link) ends on the right title.
export function refreshViewTitle() {
  const section = document.querySelector('.stage.active-section')?.dataset.section;
  let title = LANDING_TITLE;
  if (section === 'blog') title = blogTitle();
  else if (SECTION_NAMES[section]) title = `${SECTION_NAMES[section]} | ${SITE_NAME}`;
  if (document.title !== title) document.title = title;
}

export function postTitle(title) {
  return `${title} | ${SITE_NAME}`;
}
