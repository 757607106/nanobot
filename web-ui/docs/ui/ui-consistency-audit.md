# UI 一致性与性能审计报告

## 构建产物体积（dist/assets）

| 文件 | 体积 |
|---|---:|
| vendor-CaeBtTZW.js | 5.98 MB |
| chunk-graph-BQHcu3QN.js | 1.53 MB |
| antd-C6HL0ZZd.js | 1.44 MB |
| worker-B9qc9nkC.js | 303.5 KB |
| pkg-html2canvas-Bxw5drDI.js | 179.3 KB |
| react-core-dPa_jv76.js | 140.7 KB |
| pkg-lodash-D5QRJgcT.js | 117.2 KB |
| vendor-BU66-h4g.css | 105.6 KB |
| pkg-yaml-RrwvUN8j.js | 95.9 KB |
| index-DbHs1hzO.js | 95.3 KB |
| noto-sans-sc-119-wght-normal-BfzSEbFz.woff2 | 75.0 KB |
| pkg-ml-matrix-CBReAOch.js | 66.2 KB |
| noto-sans-sc-45-wght-normal-MKIEVRIC.woff2 | 66.0 KB |
| noto-sans-sc-22-wght-normal-VXjdYcT-.woff2 | 63.9 KB |
| noto-sans-sc-108-wght-normal-7aXvqIa2.woff2 | 63.0 KB |
| noto-sans-sc-100-wght-normal-DrqXJETY.woff2 | 63.0 KB |
| noto-sans-sc-103-wght-normal-DGHo20nu.woff2 | 62.4 KB |
| noto-sans-sc-111-wght-normal-ClFr5QXM.woff2 | 61.2 KB |
| noto-sans-sc-106-wght-normal-D6uUHw3w.woff2 | 61.2 KB |
| noto-sans-sc-24-wght-normal-B58DWgHS.woff2 | 61.1 KB |
| noto-sans-sc-105-wght-normal-BFoiJwz2.woff2 | 60.4 KB |
| noto-sans-sc-104-wght-normal-CJT2ioDJ.woff2 | 60.1 KB |
| noto-sans-sc-110-wght-normal-D2JBr045.woff2 | 60.0 KB |
| noto-sans-sc-107-wght-normal-kFQzJDLH.woff2 | 59.6 KB |
| noto-sans-sc-102-wght-normal-C1RtbCZr.woff2 | 59.3 KB |

- >500KB 文件数：3

## 建议

- 优先把 markdown/highlight/katex/antv 等重依赖收敛到路由级按需加载边界
- 保持 antd 独立 chunk，避免与 markdown 产生循环依赖
