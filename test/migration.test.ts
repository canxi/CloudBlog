/**
 * Migration utilities tests
 */

import { describe, it, expect } from 'vitest';
import { parseWordPressXML, countWordPressPosts } from '../src/utils/wordpress-parser';
import { parseMarkdownFile, parseMarkdownFiles } from '../src/utils/markdown-importer';

const SAMPLE_WP_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:excerpt="http://wordpress.org/export/1.2/excerpt/"
  xmlns:content="http://purl.org/rss/1.0/modules/content/"
  xmlns:wfw="http://wellformedweb.org/CommentAPI/"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:wp="http://wordpress.org/export/1.2/">
  <channel>
    <title>Test Blog</title>
    <item>
      <title>Hello World Post</title>
      <link>https://example.com/hello-world</link>
      <pubDate>Mon, 01 Jan 2024 12:00:00 +0000</pubDate>
      <dc:creator>admin</dc:creator>
      <guid isPermaLink="false">https://example.com/?p=1</guid>
      <description></description>
      <content:encoded><![CDATA[<p>This is the content of my first post.</p><img src="https://example.com/image.jpg" />]]></content:encoded>
      <excerpt:encoded><![CDATA[First post excerpt]]></excerpt:encoded>
      <wp:post_id>1</wp:post_id>
      <wp:post_date><![CDATA[2024-01-01 12:00:00]]></wp:post_date>
      <wp:post_date_gmt><![CDATA[2024-01-01 12:00:00]]></wp:post_date_gmt>
      <wp:post_modified><![CDATA[2024-01-01 12:00:00]]></wp:post_modified>
      <wp:comment_status>open</wp:comment_status>
      <wp:ping_status>open</wp:ping_status>
      <wp:post_name><![CDATA[hello-world]]></wp:post_name>
      <wp:status>publish</wp:status>
      <wp:post_type>post</wp:post_type>
      <category domain="category" nicename="tech"><![CDATA[Technology]]></category>
      <category domain="post_tag" nicename="ai"><![CDATA[AI]]></category>
    </item>
    <item>
      <title>Draft Post</title>
      <link>https://example.com/draft-post</link>
      <pubDate>Tue, 02 Jan 2024 12:00:00 +0000</pubDate>
      <content:encoded><![CDATA[<p>Draft content here.</p>]]></content:encoded>
      <wp:post_id>2</wp:post_id>
      <wp:post_name><![CDATA[draft-post]]></wp:post_name>
      <wp:status>draft</wp:status>
      <wp:post_type>post</wp:post_type>
    </item>
    <item>
      <title>Page Not Post</title>
      <wp:post_type>page</wp:post_type>
      <wp:status>publish</wp:status>
    </item>
  </channel>
</rss>`;

describe('WordPress XML Parser', () => {
  it('should parse WordPress XML and extract posts', () => {
    const posts = parseWordPressXML(SAMPLE_WP_XML);
    expect(posts).toHaveLength(2); // Only posts, not pages
  });

  it('should extract post title, content, and metadata', () => {
    const posts = parseWordPressXML(SAMPLE_WP_XML);
    const first = posts[0];
    expect(first.title).toBe('Hello World Post');
    expect(first.slug).toBe('hello-world');
    expect(first.content).toContain('This is the content');
    expect(first.status).toBe('published');
  });

  it('should extract categories and tags', () => {
    const posts = parseWordPressXML(SAMPLE_WP_XML);
    const first = posts[0];
    expect(first.categories).toContain('Technology');
    expect(first.tags).toContain('AI');
  });

  it('should handle draft posts', () => {
    const posts = parseWordPressXML(SAMPLE_WP_XML);
    const draft = posts.find(p => p.title === 'Draft Post');
    expect(draft?.status).toBe('draft');
  });

  it('should count posts correctly', () => {
    const count = countWordPressPosts(SAMPLE_WP_XML);
    expect(count).toBe(2);
  });
});

const SAMPLE_MARKDOWN = `---
title: My First Article
slug: my-first-article
date: 2024-01-15
categories:
  - Technology
  - Development
tags:
  - TypeScript
  - Cloudflare
author: John Doe
excerpt: A short description
---

# Introduction

This is the content of my article. It has **bold** and *italic* text.

![An image](https://example.com/image.png)

## Section 2

More content here.
`;

describe('Markdown Importer', () => {
  it('should parse frontmatter and body', () => {
    const post = parseMarkdownFile(SAMPLE_MARKDOWN, 'my-first-article.md');
    expect(post.title).toBe('My First Article');
    expect(post.slug).toBe('my-first-article');
    expect(post.categories).toContain('Technology');
    expect(post.tags).toContain('TypeScript');
    expect(post.content).toContain('# Introduction');
  });

  it('should extract first image as cover', () => {
    const post = parseMarkdownFile(SAMPLE_MARKDOWN, 'test.md');
    expect(post.coverImage).toBe('https://example.com/image.png');
  });

  it('should use filename as title when no frontmatter title', () => {
    const post = parseMarkdownFile('No frontmatter content', 'my-cool-post.md');
    expect(post.title).toBe('my cool post');
  });

  it('should handle files array', () => {
    const files = [
      { name: 'post1.md', content: '---\ntitle: Post One\n---\nContent 1' },
      { name: 'post2.md', content: '---\ntitle: Post Two\n---\nContent 2' },
    ];
    const posts = parseMarkdownFiles(files);
    expect(posts).toHaveLength(2);
    expect(posts[0].title).toBe('Post One');
    expect(posts[1].title).toBe('Post Two');
  });
});
