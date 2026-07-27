const [major] = process.versions.node.split(".").map(Number);

if (major !== 24) {
  console.error(
    `Freedom Bot은 Node.js 24 LTS가 필요합니다. 현재 버전: ${process.version}`,
  );
  console.error(
    "Node 버전을 변경한 뒤 node_modules를 삭제하고 npm ci를 다시 실행해 주세요.",
  );
  process.exit(1);
}
