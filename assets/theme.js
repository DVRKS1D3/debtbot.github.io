/* Переключатель темы: система → светлая → тёмная.
   Подключается в <head> без defer, чтобы сохранённый выбор применился до
   первой отрисовки и страница не мигала светлым.
   Без JavaScript страница просто остаётся на системной теме. */
(function () {
  var root = document.documentElement;
  var KEY = "theme";
  var MODES = [null, "light", "dark"];
  var LABELS = {
    system: "Тема: как в системе",
    light: "Тема: светлая",
    dark: "Тема: тёмная"
  };
  var button = null;

  // Кнопку показываем только когда есть JavaScript (см. .theme-toggle в CSS)
  root.classList.add("js");

  var saved = null;
  try {
    saved = localStorage.getItem(KEY);
  } catch (e) {
    saved = null;
  }
  if (MODES.indexOf(saved) > 0) root.dataset.theme = saved;

  function current() {
    return root.dataset.theme || "system";
  }

  function refreshButton() {
    if (!button) return;
    var hint = LABELS[current()] + " — нажмите, чтобы переключить";
    button.title = hint;
    button.setAttribute("aria-label", hint);
  }

  function apply(value) {
    if (value) {
      root.dataset.theme = value;
    } else {
      delete root.dataset.theme;
    }
    try {
      if (value) {
        localStorage.setItem(KEY, value);
      } else {
        localStorage.removeItem(KEY);
      }
    } catch (e) {
      /* приватный режим или file:// — тема просто не запомнится */
    }
    refreshButton();
  }

  function next() {
    var index = MODES.indexOf(root.dataset.theme || null);
    return MODES[(index + 1) % MODES.length];
  }

  document.addEventListener("DOMContentLoaded", function () {
    button = document.querySelector(".theme-toggle");
    if (!button) return;
    refreshButton();
    button.addEventListener("click", function () {
      apply(next());
    });
  });
})();
