import { fileName } from './backup.js';

export function download(text, kind, at, ext) {
  const blob = new Blob([text], {
    type: ext === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.download = fileName(kind, at, ext);
  link.href = url;
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
}
