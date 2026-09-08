<template>
  <div>
    <h1>How the readiness score is computed</h1>
    <p class="muted">This page describes exactly what the code does. If it disagrees with the app, the app is wrong.</p>
    <div class="card">
      <h2>1. One probability per exam section</h2>
      <p>Your state's exam has a published blueprint: so many scored items per section. For each section we estimate the chance you answer one of its items correctly, from your recent answers on that section's questions.</p>
      <ul>
        <li><strong>Recency.</strong> Every answer is weighted by how recent it is, halving in weight every 7 days. Old mistakes fade; so do old lucky streaks.</li>
        <li><strong>Shrinkage.</strong> A section with only a few answers is pulled toward your overall accuracy (six pseudo-answers' worth), so one guess cannot make a section look "solid".</li>
        <li><strong>Unseen sections</strong> take your overall accuracy with wider uncertainty.</li>
      </ul>
      <h2>2. Expected score and range</h2>
      <p>Expected score = Σ (items in section × your probability for that section). The 90% range combines uncertainty in each estimate with the randomness of which items the real exam draws. Where the state publishes a pass mark we can express in items, we report the probability your score clears it.</p>
      <h2>3. What it does not do</h2>
      <ul>
        <li>It does not count questions you have only read. Only answers count.</li>
        <li>It does not know the real exam's items. It assumes our questions are representative of the blueprint, which is the whole point of building to the blueprint.</li>
        <li>It assumes one person is answering. If several people share an account the score describes nobody.</li>
      </ul>
      <h2>4. The coverage meter</h2>
      <p>"Solid on 7 of 10" means: of the items you have seen in that section, greens count fully and yellows half; that fraction times the section's exam item count, rounded. We refuse to claim anything until you have answered at least three items in a section.</p>
      <h2>5. Boxes</h2>
      <p>Red: due now. Yellow: right once, due in 2 days. Green: right twice, due in 6 days, then 14, then 30. A question missed four times is a leech and goes to a focused drill instead of the normal rotation.</p>
    </div>
  </div>
</template>
