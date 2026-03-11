'use strict';

/**
 * Scroll Container Detection
 *
 * NOTE: ScreenVault captures EXTERNAL applications via screencapture -R
 * and scrolls them via CGEvent scroll wheel events. We cannot access the
 * DOM of external apps, so scroll container detection is not applicable.
 *
 * This module is included for completeness. If ScreenVault ever adds
 * in-app web capture (via webContents.capturePage), this would be used
 * to find the correct scroll container in the target page.
 */

/**
 * Find the primary scrollable element in a web page.
 * Intended for use with webContents.executeJavaScript().
 *
 * @returns {string} JavaScript code string to execute in a web context
 */
function getScrollContainerScript() {
  return `
    (function findScrollableElement() {
      const elements = [...document.querySelectorAll('*')];
      const scrollables = elements.filter(el => {
        const style = getComputedStyle(el);
        return (
          (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
          el.scrollHeight > el.clientHeight
        );
      });

      if (scrollables.length === 0) {
        return document.scrollingElement;
      }

      scrollables.sort((a, b) => b.scrollHeight - a.scrollHeight);
      return scrollables[0];
    })()
  `;
}

module.exports = { getScrollContainerScript };
