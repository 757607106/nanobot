# UI 一致性与性能审计报告

## 构建产物体积（dist/assets）

| 文件 | 体积 |
|---|---:|
| vendor-eZTIO0Dl.js | 3.80 MB |
| pkg-highlight.js-D7w-B5v9.js | 1.68 MB |
| antd-CZBpgseB.js | 1.37 MB |
| pkg-katex-CI6QwN2a.js | 508.8 KB |
| pkg-antv-g6-GqqavU0D.js | 306.4 KB |
| worker-B9qc9nkC.js | 303.5 KB |
| pkg-antv-g-lite-Detss3Lo.js | 216.7 KB |
| pkg-html2canvas-Bxw5drDI.js | 179.3 KB |
| pkg-antv-component-CC2m-8p-.js | 153.2 KB |
| react-core-DMX3MsSR.js | 140.7 KB |
| pkg-markmap-html-parser-D4r4liOa.js | 114.3 KB |
| pkg-yaml-RrwvUN8j.js | 95.9 KB |
| pkg-antv-layout-BoCstAjP.js | 87.0 KB |
| index-Bz8CkrER.js | 84.9 KB |
| index-CkVsEAii.css | 80.3 KB |
| pkg-ml-matrix-dYPophus.js | 66.2 KB |
| index-DFGFCbOg.js | 51.4 KB |
| pkg-markdown-it-Bw58a35I.js | 48.1 KB |
| pkg-lodash-Cs9jqwOn.js | 45.9 KB |
| index-DusCnS5J.js | 42.3 KB |
| index-FwJfJ2vI.js | 39.8 KB |
| pkg-antv-g-canvas-DArFp-zU.js | 37.5 KB |
| pkg-antv-g-fl64iGll.js | 35.5 KB |
| ChatPage-cOqYzLte.js | 35.2 KB |
| index-DQzGf7h2.js | 30.8 KB |

- >500KB 文件数：4

## 建议

- 优先把 markdown/highlight/katex/antv 等重依赖收敛到路由级按需加载边界
- 保持 antd 独立 chunk，避免与 markdown 产生循环依赖
