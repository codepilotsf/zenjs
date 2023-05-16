// interface ModifiersQueue {
//   [key: string]: {
//     type: "addClass" | "removeClass" | "setAttr" | "removeAttr";
//     data: string[];
//   }[];
// }

// Process the elementsToModify (add/remove classes and attributes).
export function parseModifiers(dom, ctx) {
  // First parse declarative modifiers.

  // z-active
  const zActiveEls = dom.querySelectorAll("[z-active]");
  zActiveEls.forEach((el) => {
    const zActiveValue = el.getAttribute("z-active");

    // Special '@' value means the element is active current page matches href.
    if (zActiveValue === "@") {
      const href = el.getAttribute("href").split("#")[0].split("?")[0];
      const isActivePath = ctx.$meta.pathname.startsWith(href);
      if (isActivePath) {
        el.classList.add("active");
        el.setAttribute("z-active", "true");
      } else {
        el.classList.remove("active");
        el.setAttribute("z-active", "false");
      }
    } // Otherwise, just add/remove the 'active' class.
    else {
      isFalsey(zActiveValue)
        ? el.classList.remove("active")
        : el.classList.add("active");
      el.setAttribute("z-active", isFalsey(zActiveValue) ? "false" : "true");
    }
  });

  // z-invalid
  const zInvalidEls = dom.querySelectorAll("[z-invalid]");
  zInvalidEls.forEach((el) => {
    const zInvalidValue = el.getAttribute("z-invalid");
    isFalsey(zInvalidValue)
      ? el.classList.remove("invalid")
      : el.classList.add("invalid");
    el.setAttribute("z-invalid", isFalsey(zInvalidValue) ? "false" : "true");
  });

  // z-disabled
  const zDisabledEls = dom.querySelectorAll("[z-disabled]");
  zDisabledEls.forEach((el) => {
    const zDisabledValue = el.getAttribute("z-disabled");
    isFalsey(zDisabledValue)
      ? el.removeAttribute("disabled")
      : el.setAttribute("disabled");

    el.setAttribute("z-disabled", isFalsey(zDisabledValue) ? "false" : "true");
  });

  // z-checked
  const zCheckedEls = dom.querySelectorAll("[z-checked]");
  zCheckedEls.forEach((el) => {
    const zCheckedValue = el.getAttribute("z-checked");
    isFalsey(zCheckedValue)
      ? el.removeAttribute("checked")
      : el.setAttribute("checked", "checked");
    el.setAttribute("z-checked", isFalsey(zCheckedValue) ? "false" : "true");
  });

  // z-selected
  const zSelectedEls = dom.querySelectorAll("[z-selected]");
  zSelectedEls.forEach((el) => {
    const zSelectedValue = el.getAttribute("z-selected");
    isFalsey(zSelectedValue)
      ? el.removeAttribute("selected")
      : el.setAttribute("selected", "selected");
    el.setAttribute("z-selected", isFalsey(zSelectedValue) ? "false" : "true");
  });

  // Then parse imperative modifiers.
  for (const [id, modifiers] of Object.entries(ctx.elementsToModify)) {
    modifiers.forEach((modifier) => {
      switch (modifier.type) {
        case "addClass":
          dom.getElementById(id)?.classList.add(...modifier.data);
          break;
        case "removeClass":
          dom.getElementById(id)?.classList.remove(...modifier.data);
          break;
        case "setAttr":
          dom
            .getElementById(id)
            ?.setAttribute(modifier.data[0], modifier.data[1]);

          break;
        case "removeAttr":
          dom.getElementById(id)?.removeAttribute(modifier.data[0]);
          break;
      }
    });
  }
  return dom;
}

function isFalsey(value) {
  return ["false", "0", "null", "undefined", ""].includes(value);
}
