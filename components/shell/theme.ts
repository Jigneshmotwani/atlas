// Theme persistence shared by the layout's inline script and ThemeToggle (plain module, no 'use client').
export const THEME_KEY = 'atlas.theme.v1';

/** Inline <head> script: applies the saved theme to <html data-theme> before first paint. */
export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`;
