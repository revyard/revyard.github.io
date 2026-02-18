const fs = require('fs');
const { JSDOM } = require('jsdom');
const path = require('path');

// Get course folder and checkpoint filename from command line arguments
const courseFolder = process.argv[2];
const checkpointName = process.argv[3];

if (!courseFolder || !checkpointName) {
  console.error('❌ Usage: node qs_extract_quizbank_all.js <course_folder> <checkpoint_name>');
  console.error('   Example: node qs_extract_quizbank_all.js dev-net checkpoint1');
  process.exit(1);
}

// Ensure course structure exists
function ensureCourseStructure(courseFolder) {
  const assetsDir = 'assets';
  const courseDir = path.join(assetsDir, courseFolder);
  const htmlDir = path.join(courseDir, 'html');
  const jsonDir = path.join(courseDir, 'json');

  // Create directories if they don't exist
  if (!fs.existsSync(htmlDir)) {
    fs.mkdirSync(htmlDir, { recursive: true });
    console.log(`📁 Created: ${htmlDir}`);
  }
  if (!fs.existsSync(jsonDir)) {
    fs.mkdirSync(jsonDir, { recursive: true });
    console.log(`📁 Created: ${jsonDir}`);
  }

  // Update courses.json if course doesn't exist
  const coursesFile = path.join(assetsDir, 'courses.json');
  let courses = [];

  if (fs.existsSync(coursesFile)) {
    courses = JSON.parse(fs.readFileSync(coursesFile, 'utf-8'));
  }

  const courseExists = courses.some(c => c.id === courseFolder);

  if (!courseExists) {
    const courseName = courseFolder
      .replace(/-/g, ' ')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());

    const newCourse = {
      id: courseFolder,
      name: courseName,
      modules: []
    };
    courses.push(newCourse);

    fs.writeFileSync(coursesFile, JSON.stringify(courses, null, 2), 'utf-8');
    console.log(`📝 Added course "${courseName}" to courses.json`);
  }

  return { courseDir, htmlDir, jsonDir };
}

// Update course module in courses.json
function updateCourseModule(courseFolder, checkpointName) {
  const coursesFile = 'assets/courses.json';

  if (!fs.existsSync(coursesFile)) return;

  const courses = JSON.parse(fs.readFileSync(coursesFile, 'utf-8'));

  for (const course of courses) {
    if (course.id === courseFolder) {
      const modules = course.modules || [];

      // Check if checkpoint already exists in any module
      let checkpointExists = false;
      for (const module of modules) {
        if (module.checkpoints && module.checkpoints.includes(checkpointName)) {
          checkpointExists = true;
          break;
        }
      }

      if (!checkpointExists) {
        // Determine next module ID
        const existingIds = modules.map(m => m.id || 0);
        const nextId = Math.max(0, ...existingIds) + 1;

        // Create new module
        const moduleName = checkpointName
          .replace(/_/g, ' ')
          .replace(/-/g, ' ')
          .replace(/\b\w/g, c => c.toUpperCase());

        const newModule = {
          id: nextId,
          name: moduleName,
          checkpoints: [checkpointName]
        };
        modules.push(newModule);
        course.modules = modules;

        fs.writeFileSync(coursesFile, JSON.stringify(courses, null, 2), 'utf-8');
        console.log(`📚 Added module: ${checkpointName} (ID: ${nextId})`);
      }

      break;
    }
  }
}

// Ensure course structure
const { htmlDir, jsonDir } = ensureCourseStructure(courseFolder);

const htmlPath = path.join(htmlDir, `${checkpointName}.html`);
const jsonPath = path.join(jsonDir, `${checkpointName}.json`);

// Check if HTML file exists
if (!fs.existsSync(htmlPath)) {
  console.error(`❌ File not found: ${htmlPath}`);
  process.exit(1);
}

const htmlContent = fs.readFileSync(htmlPath, 'utf-8');
const dom = new JSDOM(htmlContent);
const document = dom.window.document;

// Get stats from HTML - find by label text
const statCards = document.querySelectorAll('.stat-card');
const stats = {
  total: 0,
  correct: 0,
  wrong: 0,
  new: 0
};

statCards.forEach(card => {
  const label = card.querySelector('.stat-label');
  const value = card.querySelector('.stat-value');
  if (label && value) {
    const labelText = label.textContent.toLowerCase();
    const numValue = parseInt(value.textContent) || 0;
    if (labelText.includes('total')) stats.total = numValue;
    else if (labelText.includes('correct')) stats.correct = numValue;
    else if (labelText.includes('wrong')) stats.wrong = numValue;
    else if (labelText.includes('new')) stats.new = numValue;
  }
});

// Extract all questions
const questionElements = document.querySelectorAll('.display_question');
const extractedQuestions = [];
let questionsWithAnswer = 0;
let questionsWithoutAnswer = 0;

questionElements.forEach((questionEl) => {
  try {
    // Get question text
    const questionTextEl = questionEl.querySelector('.question_text');
    if (!questionTextEl) return;

    // Check the answer source badge
    const sourceBadge = questionTextEl.querySelector('.answer-source-badge');
    const isNewQuestion = sourceBadge && sourceBadge.classList.contains('new-source');
    const isWrongAnswer = sourceBadge && sourceBadge.textContent.toLowerCase().includes('wrong');

    // Extract the text content, removing the badge elements
    const questionTextClone = questionTextEl.cloneNode(true);
    const badgeClone = questionTextClone.querySelector('.answer-source-badge');
    if (badgeClone) {
      badgeClone.remove();
    }
    let questionText = questionTextClone.textContent.trim();

    // Check if there's an image in the question
    const imgEl = questionTextEl.querySelector('img');
    let imgSrc = null;
    if (imgEl) {
      imgSrc = imgEl.getAttribute('src');
    }

    // Get all answer choices
    const answerLabels = questionEl.querySelectorAll('.answer_label');
    const choices = [];
    const correctAnswers = [];

    if (answerLabels.length > 0) {
      answerLabels.forEach((answerLabel) => {
        // Get the choice text
        const choiceTextNode = answerLabel.cloneNode(true);
        // Remove any badges from the choice text
        const badges = choiceTextNode.querySelectorAll('.correct-answer-badge, .wrong-answer-badge');
        badges.forEach(badge => badge.remove());
        const choiceText = choiceTextNode.textContent.trim();

        if (choiceText) {
          choices.push(choiceText);

          // Check if this is a correct answer (only if not a new/wrong question)
          if (!isNewQuestion && !isWrongAnswer) {
            const correctBadge = answerLabel.parentElement.querySelector('.correct-answer-badge');
            if (correctBadge) {
              correctAnswers.push(choiceText);
            }
          }
        }
      });
    } else {
      // Handle matching questions or other formats
      const matchingLabels = questionEl.querySelectorAll('.pull-left label');
      const selectOptions = questionEl.querySelectorAll('select option');

      matchingLabels.forEach(label => {
        const text = label.textContent.trim();
        if (text) choices.push(text);
      });

      selectOptions.forEach(opt => {
        const text = opt.textContent.trim();
        if (text && text !== '[ Choose ]' && !choices.includes(text)) {
          choices.push(text);
        }
      });
    }

    // Add all questions that have choices
    if (choices.length > 0) {
      const questionObj = {
        question: questionText
      };

      // Add image if present
      if (imgSrc) {
        questionObj.img = imgSrc;
      }

      questionObj.choices = choices;

      // If it's a new question or wrong answer, keep answer blank
      // Otherwise use the correct answer(s)
      if (isNewQuestion || isWrongAnswer || correctAnswers.length === 0) {
        questionObj.answer = "";
        questionsWithoutAnswer++;
      } else if (correctAnswers.length > 1) {
        questionObj.answer = correctAnswers;
        questionsWithAnswer++;
      } else {
        questionObj.answer = correctAnswers[0];
        questionsWithAnswer++;
      }

      extractedQuestions.push(questionObj);
    }
  } catch (error) {
    console.error('Error processing question:', error);
  }
});

// Write to JSON file
fs.writeFileSync(jsonPath, JSON.stringify(extractedQuestions, null, 2), 'utf-8');

// Update courses.json with the new module
updateCourseModule(courseFolder, checkpointName);

// Display results
console.log(`\n📊 ${checkpointName} - Extraction Summary:`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`HTML Stats:`);
console.log(`  Total Questions:        ${stats.total}`);
console.log(`  ✅ Correct Answers:     ${stats.correct}`);
console.log(`  🚫 Wrong Answers:       ${stats.wrong}`);
console.log(`  ✨ New/Partial/Unknown: ${stats.new}`);
console.log(`\nExtracted:`);
console.log(`  Total Questions:        ${extractedQuestions.length}`);
console.log(`  ✅ With Answer:         ${questionsWithAnswer}`);
console.log(`  ❓ Blank Answer:        ${questionsWithoutAnswer}`);
console.log(`\n✅ Match: ${extractedQuestions.length === stats.total ? 'PERFECT ✓' : 'MISMATCH ✗'}`);
console.log(`📝 Updated: ${jsonPath}`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
