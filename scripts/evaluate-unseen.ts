import { runUnseenEvaluation } from './lib/unseen.ts';

async function main() {
  console.log('==================================================');
  console.log('UNSEEN TEST SET EVALUATION (GENERALIZATION)');
  console.log('==================================================\n');

  try {
    const result = await runUnseenEvaluation();

    console.log(`Total Samples: ${result.total}`);
    console.log(`Correct:       ${result.correct}`);
    console.log(`Incorrect:     ${result.incorrect}`);
    console.log(`Accuracy:      ${result.accuracy.toFixed(1)}%\n`);

    console.log('--------------------------------------------------');
    console.log('CONFIDENCE BREAKDOWN');
    console.log('--------------------------------------------------');
    console.log('Confidence Level       Total   Correct   Accuracy');
    console.log('--------------------------------------------------');
    for (const conf of ['high', 'medium', 'boundary'] as const) {
      const b = result.confidenceBreakdown[conf];
      const confLabel = (conf.charAt(0).toUpperCase() + conf.slice(1)).padEnd(20);
      const totalStr = String(b.total).padStart(7);
      const correctStr = String(b.correct).padStart(9);
      const accStr = `${b.accuracy.toFixed(1)}%`.padStart(11);
      console.log(`${confLabel} ${totalStr} ${correctStr} ${accStr}`);
    }
    console.log();

    console.log('--------------------------------------------------');
    console.log('CATEGORY BREAKDOWN');
    console.log('--------------------------------------------------');
    console.log('Category              Expected   Correct   Accuracy');
    console.log('--------------------------------------------------');

    for (const cat of Object.keys(result.categorySummary)) {
      const s = result.categorySummary[cat];
      if (s.expectedCount === 0) continue;
      const catName = s.category.padEnd(20);
      const expStr = String(s.expectedCount).padStart(9);
      const corrStr = String(s.correctCount).padStart(9);
      const accStr = `${s.accuracy.toFixed(1)}%`.padStart(11);
      console.log(`${catName} ${expStr} ${corrStr} ${accStr}`);
    }

    if (result.errors.length > 0) {
      console.log('\n--------------------------------------------------');
      console.log(`INCORRECT CLASSIFICATIONS (${result.errors.length})`);
      console.log('--------------------------------------------------');

      result.errors.forEach((err, idx) => {
        console.log(`[${idx + 1}] ${err.fullName}`);
        console.log(`    Expected:   ${err.expected} (${err.groundTruthConfidence})`);
        console.log(`    Predicted:  ${err.predicted}`);
        console.log(`    Method:     ${err.method} | Confidence: ${err.confidence}`);
        console.log(`    Rationale:  ${err.rationale}\n`);
      });
    }

    console.log('==================================================');
  } catch (error) {
    console.error('[evaluate:unseen] ERROR:', error);
    process.exit(1);
  }
}

main();
