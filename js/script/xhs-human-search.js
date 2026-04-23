/**
 * 小红书 PC 站拟人化搜索脚本
 *
 * 使用方式：
 *   - 作为扩展 content script 随小红书页面加载后，window.humanSearch 已就绪；
 *     业务在打开搜索页并等待加载完成后调用 humanSearch("关键词")。
 *   - 亦可手动：打开 https://www.xiaohongshu.com/explore 后粘贴到 Console 执行本段代码。
 *
 * 流程：
 *   鼠标从随机起点沿 smoothstep 曲线平滑移动到搜索框
 *   -> 双击选中已有文字 -> 清空 -> 逐字输入新关键词 -> 回车提交
 *
 * 说明：本脚本仅复刻正常用户 UI 操作，不修改任何埋点/风控数据，
 * 不保证绕过小红书风控策略，频繁调用仍可能被限流。
 */
(function (global) {
  "use strict";

  const rand = (a, b) => a + Math.random() * (b - a);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const setNativeValue = (el, v) => {
    const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    d && d.set ? d.set.call(el, v) : (el.value = v);
  };

  const fire = (el, type, init = {}) => {
    const Ctor =
      type.startsWith("key")
        ? KeyboardEvent
        : type.startsWith("mouse") ||
          type === "click" ||
          type === "dblclick" ||
          type === "contextmenu"
        ? MouseEvent
        : type === "input" || type === "beforeinput"
        ? InputEvent
        : Event;
    const ev = new Ctor(
      type,
      Object.assign({ bubbles: true, cancelable: true, composed: true }, init)
    );
    el.dispatchEvent(ev);
  };

  async function moveMouseTo(targetEl) {
    const r = targetEl.getBoundingClientRect();
    const endX = r.left + r.width * (0.3 + Math.random() * 0.4);
    const endY = r.top + r.height * (0.4 + Math.random() * 0.2);
    const startX = Math.max(5, endX - rand(180, 360));
    const startY = Math.max(5, endY - rand(80, 220));

    const steps = 18 + Math.floor(Math.random() * 10);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const e = t * t * (3 - 2 * t);
      const x = startX + (endX - startX) * e + (Math.random() - 0.5) * 6;
      const y = startY + (endY - startY) * e + (Math.random() - 0.5) * 6;
      const tgt = document.elementFromPoint(x, y) || document.body;
      fire(tgt, "mousemove", { clientX: x, clientY: y, button: 0 });
      await sleep(rand(8, 22));
    }
    fire(targetEl, "mouseover", { clientX: endX, clientY: endY });
    fire(targetEl, "mouseenter", { clientX: endX, clientY: endY });
    await sleep(rand(60, 140));
    return { x: endX, y: endY };
  }

  function clickOnce(el, pt, detail) {
    fire(el, "mousedown", {
      clientX: pt.x,
      clientY: pt.y,
      button: 0,
      detail,
    });
    fire(el, "mouseup", {
      clientX: pt.x,
      clientY: pt.y,
      button: 0,
      detail,
    });
    fire(el, "click", {
      clientX: pt.x,
      clientY: pt.y,
      button: 0,
      detail,
    });
  }

  async function doubleClickSelectAll(el, pt) {
    clickOnce(el, pt, 1);
    await sleep(rand(60, 140));
    clickOnce(el, pt, 2);
    fire(el, "dblclick", {
      clientX: pt.x,
      clientY: pt.y,
      button: 0,
      detail: 2,
    });
    el.focus();
    try {
      el.setSelectionRange(0, el.value.length);
    } catch (_) {}
    if (el.value) {
      setNativeValue(el, "");
      fire(el, "input", { inputType: "deleteContentBackward", data: null });
    }
  }

  async function typeKeyword(el, keyword) {
    let buf = "";
    for (const ch of keyword) {
      fire(el, "keydown", { key: ch });
      fire(el, "beforeinput", { inputType: "insertText", data: ch });
      buf += ch;
      setNativeValue(el, buf);
      fire(el, "input", { inputType: "insertText", data: ch });
      fire(el, "keyup", { key: ch });
      await sleep(rand(60, 180));
    }
  }

  function pressEnter(el) {
    const init = { key: "Enter", code: "Enter", keyCode: 13, which: 13 };
    fire(el, "keydown", init);
    fire(el, "keypress", init);
    fire(el, "keyup", init);
  }

  function resolveSearchInputEl() {
    const byId = document.querySelector("#search-input");
    if (byId) {
      if (byId.tagName === "INPUT") return byId;
      const inner = byId.querySelector("input");
      if (inner) return inner;
    }
    const candidates = [
      ".search-input input",
      'input[placeholder*="搜索"]',
      'input[placeholder*="搜"]',
      'input[type="search"]',
    ];
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el && (el.offsetParent != null || el.getBoundingClientRect().width > 0))
        return el;
    }
    return null;
  }

  async function humanSearch(keyword) {
    keyword = String(keyword || "").trim();
    if (!keyword) {
      console.error("[humanSearch] 请提供关键词");
      return false;
    }
    const input = resolveSearchInputEl();
    if (!input) {
      console.error(
        "[humanSearch] 未找到顶部搜索输入框，请在搜索栏可见的页面运行"
      );
      return false;
    }

    const pt = await moveMouseTo(input);
    await doubleClickSelectAll(input, pt);
    await sleep(rand(150, 280));
    await typeKeyword(input, keyword);
    await sleep(rand(280, 560));
    pressEnter(input);
    console.log("[humanSearch] submitted:", keyword);
    return true;
  }

  global.humanSearch = humanSearch;
})(window);
