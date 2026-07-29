export const CursorTheme = {
  light: {
    fill: '#FFFFFF',
    stroke: '#111827',
  },
  dark: {
    fill: '#0F172A',
    stroke: '#F8FAFC',
  },
};

export const getTheme = () => {
  if (typeof document !== 'undefined') {
    return document.body.classList.contains('dark-theme') ? 'dark' : 'light';
  }
  return 'light';
};
