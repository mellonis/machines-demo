import { describe, expect, it } from 'vitest';
import { renderLessonMarkdown } from './lessonMarkdown';

describe('renderLessonMarkdown', () => {
  it('R-lesson-md-paragraph: wraps a single block in <p>', () => {
    expect(renderLessonMarkdown('hello world')).toBe('<p>hello world</p>');
  });

  it('R-lesson-md-multi-paragraph: splits on blank lines', () => {
    expect(renderLessonMarkdown('one\n\ntwo')).toBe('<p>one</p><p>two</p>');
  });

  it('R-lesson-md-bullets: renders a `- ` block as <ul><li>', () => {
    expect(renderLessonMarkdown('- a\n- b')).toBe('<ul><li>a</li><li>b</li></ul>');
  });

  it('R-lesson-md-inline-code: backticks become <code>', () => {
    expect(renderLessonMarkdown('use `foo` here')).toBe(
      '<p>use <code>foo</code> here</p>',
    );
  });

  it('R-lesson-md-escape: escapes HTML in source', () => {
    expect(renderLessonMarkdown('a < b & c > d')).toBe(
      '<p>a &lt; b &amp; c &gt; d</p>',
    );
  });

  it('R-lesson-md-mixed: paragraph then list then paragraph', () => {
    const src = 'intro paragraph\n\n- one\n- two\n\nclosing';
    expect(renderLessonMarkdown(src)).toBe(
      '<p>intro paragraph</p><ul><li>one</li><li>two</li></ul><p>closing</p>',
    );
  });

  it('R-lesson-md-inline-code-in-bullet: backticks inside list items', () => {
    expect(renderLessonMarkdown('- on `0` — write `1`')).toBe(
      '<ul><li>on <code>0</code> — write <code>1</code></li></ul>',
    );
  });
});
