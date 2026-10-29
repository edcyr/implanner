// Tiny indirection so dialogs and views can ask for a re-render without importing the router.
let rerenderFn = () => {};
export const setRerender = fn => { rerenderFn = fn; };
export const rerender = () => rerenderFn();
export const go = hash => { if (location.hash === hash) rerenderFn(); else location.hash = hash; };
