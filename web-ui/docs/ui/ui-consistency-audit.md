# UI 一致性与性能审计报告

## 构建产物体积（dist/assets）

| 文件 | 体积 |
|---|---:|
| vendor-C7f6oGNY.js | 3.66 MB |
| chunk-markdown-BBPfqN3K.js | 2.38 MB |
| antd-y-c1aDfp.js | 1.37 MB |
| chunk-graph-CQdp2uUk.js | 1.05 MB |
| worker-B9qc9nkC.js | 303.5 KB |
| pkg-html2canvas-Bxw5drDI.js | 179.3 KB |
| react-core-DMX3MsSR.js | 140.7 KB |
| pkg-yaml-RrwvUN8j.js | 95.9 KB |
| index-BCVnwG1J.js | 84.7 KB |
| pkg-ml-matrix-CUTErpyz.js | 66.2 KB |
| index-CtfJMTzN.js | 51.1 KB |
| pkg-lodash-Cs9jqwOn.js | 45.9 KB |
| index-Chfojq3Z.js | 42.0 KB |
| index-BHpqTOrM.js | 39.8 KB |
| ChatPage-Dy01wQuJ.js | 35.2 KB |
| index-rn_y-Ss9.js | 30.8 KB |
| pkg-dagre-B39qPlnq.js | 29.7 KB |
| index-BOY6ZZjT.js | 25.2 KB |
| index-CXZr_Tf9.js | 24.9 KB |
| index-B8CU4x0r.css | 24.9 KB |
| AutomationPage-IaeGHZll.js | 23.9 KB |
| pkg-gl-matrix-DFc-l9Mq.js | 23.0 KB |
| shared-runtime-NS7l3Vzw.js | 22.7 KB |
| router-DfmdXw1s.js | 19.1 KB |
| KnowledgeGraphTab-MnPiDsAg.js | 16.5 KB |

- >500KB 文件数：4

## 建议

- 优先把 markdown/highlight/katex/antv 等重依赖收敛到路由级按需加载边界
- 保持 antd 独立 chunk，避免与 markdown 产生循环依赖
