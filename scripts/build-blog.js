/**
 * Blog Builder Script
 * 
 * Converts Markdown files with frontmatter into HTML articles
 * and generates articles.json registry for the blog system.
 * 
 * Usage: npm run build-blog
 * 
 * Markdown files go in: blog/posts/*.md
 * Generated HTML goes to: blog/{hub}/{slug}.html
 * Registry output: blog/articles.json
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const POSTS_DIR = path.join(ROOT, 'blog', 'posts');
const BLOG_DIR = path.join(ROOT, 'blog');
const OUTPUT_JSON = path.join(BLOG_DIR, 'articles.json');

// Valid hubs
const VALID_HUBS = ['craft', 'cosmos', 'codex', 'convergence'];

// Hub display names
const HUB_NAMES = {
  craft: 'Craft',
  cosmos: 'Cosmos',
  codex: 'Codex',
  convergence: 'Convergence'
};

/**
 * Parse frontmatter from markdown content
 * Returns { metadata, content }
 */
function parseFrontmatter(markdown) {
  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
  const match = markdown.match(frontmatterRegex);
  
  if (!match) {
    throw new Error('Invalid frontmatter format. Must start with --- and end with ---');
  }
  
  const frontmatterRaw = match[1];
  const content = match[2].trim();
  
  // Parse YAML-like frontmatter (simple key: value pairs)
  const metadata = {};
  const lines = frontmatterRaw.split('\n');
  
  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;
    
    const key = line.slice(0, colonIndex).trim();
    let value = line.slice(colonIndex + 1).trim();
    
    // Handle arrays like [tag1, tag2]
    if (value.startsWith('[') && value.endsWith(']')) {
      value = value.slice(1, -1).split(',').map(v => v.trim());
    }
    
    metadata[key] = value;
  }
  
  return { metadata, content };
}

/**
 * Convert Markdown to HTML (simple converter)
 * Supports: paragraphs, headers, bold, italic, code, links, lists, video, blockquotes
 */
function markdownToHtml(markdown) {
  let html = markdown;
  
  // Normalize line endings
  html = html.replace(/\r\n/g, '\n');
  
  // Preserve HTML tags (video, etc.) - extract and replace with placeholders
  const htmlTags = [];
  html = html.replace(/<(video|iframe|img|audio)[^>]*>.*?<\/\1>|<(video|iframe|img|audio)[^>]*\/?>/gis, (match) => {
    htmlTags.push(match);
    return `__HTML_PLACEHOLDER_${htmlTags.length - 1}__`;
  });
  
  // Code blocks (```...```) - must be first to protect content
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (match, lang, code) => {
    const escaped = code.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<pre><code class="language-${lang || 'text'}">${escaped.trim()}</code></pre>`;
  });
  
  // Inline code (`...`)
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  
  // Headers (## Header)
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  
  // Bold (**text**)
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  
  // Italic (*text*)
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  
  // Links [text](url)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  
  // Blockquotes (> text)
  html = html.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');
  // Merge consecutive blockquotes
  html = html.replace(/<\/blockquote>\n<blockquote>/g, '\n');
  
  // Ordered lists (1. item)
  const orderedListRegex = /^(\d+\. .+\n?)+/gm;
  html = html.replace(orderedListRegex, (match) => {
    const items = match.trim().split('\n')
      .map(line => `<li>${line.replace(/^\d+\. /, '')}</li>`)
      .join('\n');
    return `<ol>\n${items}\n</ol>`;
  });
  
  // Unordered lists
  const listBlockRegex = /^(- .+\n?)+/gm;
  html = html.replace(listBlockRegex, (match) => {
    const items = match.trim().split('\n')
      .map(line => `<li>${line.replace(/^- /, '')}</li>`)
      .join('\n');
    return `<ul>\n${items}\n</ul>`;
  });
  
  // Split by blank lines (double newlines)
  const blocks = html.split(/\n\s*\n/);
  
  html = blocks.map(block => {
    block = block.trim();
    if (!block) return '';
    // Don't wrap if already wrapped in HTML tags or is a placeholder
    if (block.startsWith('<') || block.startsWith('__HTML_PLACEHOLDER_')) return block;
    // Join single newlines within paragraph as spaces (standard markdown behavior)
    return `<p>${block.replace(/\n/g, ' ')}</p>`;
  }).filter(Boolean).join('\n            ');
  
  // Restore HTML placeholders
  html = html.replace(/__HTML_PLACEHOLDER_(\d+)__/g, (match, index) => {
    return htmlTags[parseInt(index)];
  });
  
  return html;
}

/**
 * Calculate reading time (words / 200 wpm)
 */
function calculateReadingTime(content) {
  const words = content.split(/\s+/).length;
  const minutes = Math.ceil(words / 200);
  return `${minutes} min read`;
}

/**
 * Format date for display
 */
function formatDate(dateStr) {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });
}

/**
 * Generate slug from filename
 */
function slugFromFilename(filename) {
  return path.basename(filename, '.md');
}

/**
 * Generate HTML article file
 */
function generateHtml(metadata, contentHtml, slug) {
  const { title, hub, date, tags = [] } = metadata;
  const hubName = HUB_NAMES[hub];
  const formattedDate = formatDate(date);
  const readingTime = calculateReadingTime(contentHtml);
  const tagsArray = Array.isArray(tags) ? tags : [tags];
  
  const tagsHtml = tagsArray
    .map(tag => `<span class="tag">${tag}</span>`)
    .join('\n                ');
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title} - ${hubName} - Blog</title>
    <link rel="stylesheet" href="../../styles/main.css">
    <link rel="stylesheet" href="../../styles/base.css">
    <link rel="stylesheet" href="../../styles/blog.css">
</head>
<body>
    <div id="top" class="article-container">
        <nav class="breadcrumb" aria-label="Breadcrumb">
            <a href="../../index.html#blog">Blog</a> / 
            <a href="../../index.html#blog?hub=${hub}">${hubName}</a> / 
            <span>${title}</span>
        </nav>
        
        <header class="article-header">
            <h1 class="article-title">${title}</h1>
            <div class="article-meta">
                <time datetime="${date}">${formattedDate}</time>
                <span>·</span>
                <span>${readingTime}</span>
            </div>
            <div class="article-tags">
                ${tagsHtml}
            </div>
        </header>
        
        <article class="article-content">
            ${contentHtml}
        </article>
        
        <footer class="article-footer">
            <a href="../../index.html#blog?hub=${hub}" class="back-button">← Back to ${hubName}</a>
            <a href="javascript:void(0)" class="go-top-link" onclick="(this.closest('.blog-article-view') || this.closest('.article-container')).scrollTo({top: 0, behavior: 'smooth'})" aria-label="Scroll to top">↑ Top</a>
        </footer>
    </div>
</body>
</html>
`;
}

/**
 * Ensure hub directories exist
 */
function ensureHubDirs() {
  for (const hub of VALID_HUBS) {
    const hubDir = path.join(BLOG_DIR, hub);
    if (!fs.existsSync(hubDir)) {
      fs.mkdirSync(hubDir, { recursive: true });
      console.log(`📁 Created directory: blog/${hub}/`);
    }
  }
}

/**
 * Main build function
 */
function build() {
  console.log('🔨 Building blog articles...\n');
  
  // Ensure posts directory exists
  if (!fs.existsSync(POSTS_DIR)) {
    fs.mkdirSync(POSTS_DIR, { recursive: true });
    console.log('📁 Created blog/posts/ directory');
    console.log('   Add your .md files there and run again.\n');
    return;
  }
  
  // Ensure hub directories exist
  ensureHubDirs();
  
  // Get all markdown files
  const files = fs.readdirSync(POSTS_DIR).filter(f => f.endsWith('.md'));
  
  if (files.length === 0) {
    console.log('📭 No markdown files found in blog/posts/');
    console.log('   Add your .md files there and run again.\n');
    
    // Still generate empty registry
    const emptyRegistry = { craft: [], cosmos: [], codex: [], convergence: [] };
    fs.writeFileSync(OUTPUT_JSON, JSON.stringify(emptyRegistry, null, 2));
    console.log('📝 Generated empty blog/articles.json\n');
    return;
  }
  
  // Registry to build
  const registry = {
    craft: [],
    cosmos: [],
    codex: [],
    convergence: []
  };
  
  let successCount = 0;
  let errorCount = 0;
  
  for (const file of files) {
    const filePath = path.join(POSTS_DIR, file);
    const slug = slugFromFilename(file);
    
    try {
      const markdown = fs.readFileSync(filePath, 'utf-8');
      const { metadata, content } = parseFrontmatter(markdown);
      
      // Validate required fields
      if (!metadata.title) throw new Error('Missing required field: title');
      if (!metadata.hub) throw new Error('Missing required field: hub');
      if (!metadata.date) throw new Error('Missing required field: date');
      if (!metadata.excerpt) throw new Error('Missing required field: excerpt');
      
      // Validate hub
      if (!VALID_HUBS.includes(metadata.hub)) {
        throw new Error(`Invalid hub: "${metadata.hub}". Must be one of: ${VALID_HUBS.join(', ')}`);
      }
      
      // Convert content to HTML
      const contentHtml = markdownToHtml(content);
      
      // Generate full HTML file
      const html = generateHtml(metadata, contentHtml, slug);
      
      // Write to hub directory
      const outputPath = path.join(BLOG_DIR, metadata.hub, `${slug}.html`);
      fs.writeFileSync(outputPath, html);
      
      // Add to registry
      registry[metadata.hub].push({
        id: slug,
        title: metadata.title,
        date: formatDate(metadata.date),
        excerpt: metadata.excerpt
      });
      
      console.log(`✅ ${file} → blog/${metadata.hub}/${slug}.html`);
      successCount++;
      
    } catch (err) {
      console.error(`❌ ${file}: ${err.message}`);
      errorCount++;
    }
  }
  
  // Sort articles by date (newest first) within each hub
  for (const hub of VALID_HUBS) {
    registry[hub].sort((a, b) => {
      const dateA = new Date(a.date);
      const dateB = new Date(b.date);
      return dateB - dateA;
    });
  }
  
  // Write registry
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(registry, null, 2));
  
  console.log('\n📝 Generated blog/articles.json');
  console.log(`\n✨ Done! ${successCount} articles built, ${errorCount} errors.\n`);
}

// Run
build();
