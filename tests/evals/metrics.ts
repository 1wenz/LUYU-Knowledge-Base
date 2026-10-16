export type QualityMetrics = { recallAt20: number; ndcgAt8: number; mrr: number };
export function qualityMetrics(
  ranking: string[],
  relevance: Record<string, number>,
): QualityMetrics {
  const unique = [...new Set(ranking)];
  const relevant = Object.entries(relevance).filter(([, grade]) => grade > 0);
  if (!relevant.length) throw new Error("评估问题必须有正相关来源");
  const dcg = (grades: number[]) =>
    grades.reduce((sum, grade, index) => sum + (2 ** grade - 1) / Math.log2(index + 2), 0);
  const ideal = dcg(
    relevant
      .map(([, grade]) => grade)
      .sort((a, b) => b - a)
      .slice(0, 8),
  );
  const first = unique.findIndex((key) => (relevance[key] ?? 0) > 0);
  return {
    recallAt20:
      unique.slice(0, 20).filter((key) => (relevance[key] ?? 0) > 0).length / relevant.length,
    ndcgAt8: dcg(unique.slice(0, 8).map((key) => relevance[key] ?? 0)) / ideal,
    mrr: first < 0 ? 0 : 1 / (first + 1),
  };
}
export function meanQuality(values: QualityMetrics[]): QualityMetrics {
  if (!values.length) throw new Error("不能汇总空评估结果");
  const average = (field: keyof QualityMetrics) =>
    values.reduce((sum, value) => sum + value[field], 0) / values.length;
  return { recallAt20: average("recallAt20"), ndcgAt8: average("ndcgAt8"), mrr: average("mrr") };
}
