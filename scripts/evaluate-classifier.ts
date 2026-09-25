import { runEvaluation } from './lib/benchmark.ts';

async function main() {
  console.log('==================================================');
  console.log('CLASSIFIER BENCHMARK EVALUATION (BASELINE)');
  console.log('==================================================\n');

  try {
    const result = await runEvaluation();

    console.log(`Total Samples: ${result.total}`);
    console.log(`Correct:       ${result.correct}`);
    console.log(`Incorrect:     ${result.incorrect}`);
    console.log(`Accuracy:      ${result.accuracy.toFixed(1)}%\n`);

    console.log('--------------------------------------------------');
    console.log('CATEGORY BREAKDOWN');
    console.log('--------------------------------------------------');
    console.log(
      'Category'.padEnd(20) +
      'Expected'.padStart(10) +
      'Correct'.padStart(10) +
      'Precision'.padStart(12) +
      'Recall'.padStart(10)
    );
    console.log('-'.repeat(62));

    for (const [cat, stats] of Object.entries(result.categorySummary)) {
      if (stats.expectedCount > 0 || stats.correctCount > 0 || stats.falsePositives > 0) {
        const totalPredicted = stats.correctCount + stats.falsePositives;
        const precision = totalPredicted > 0 ? `${((stats.correctCount / totalPredicted) * 100).toFixed(0)}%` : 'N/A';
        const recall = stats.expectedCount > 0 ? `${((stats.correctCount / stats.expectedCount) * 100).toFixed(0)}%` : 'N/A';

        console.log(
          cat.padEnd(20) +
          String(stats.expectedCount).padStart(10) +
          String(stats.correctCount).padStart(10) +
          precision.padStart(12) +
          recall.padStart(10)
        );
      }
    }

    console.log('\n--------------------------------------------------');
    console.log(`INCORRECT CLASSIFICATIONS (${result.errors.length})`);
    console.log('--------------------------------------------------');

    result.errors.forEach((err, idx) => {
      console.log(`[${idx + 1}] ${err.fullName}`);
      console.log(`    Expected:   ${err.expected} (${err.confidenceLevel})`);
      console.log(`    Predicted:  ${err.predicted}`);
      console.log(`    Method:     ${err.method} | Confidence: ${err.confidence}`);
      console.log(`    Rationale:  ${err.rationale}\n`);
    });

    console.log('==================================================');
  } catch (error) {
    console.error('[evaluate] Evaluation failed:', error);
    process.exit(1);
  }
}

main();
