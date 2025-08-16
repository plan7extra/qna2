(function () {
  /**
   * 간단한 Q&A 게시판 - 로컬 저장소(localStorage) 기반
   * 데이터 모델
   * Question: { id, title, body, author, createdAt, answers: Answer[] }
   * Answer: { id, body, author, createdAt }
   */

  const STORAGE_KEY = 'qa.board.v1';

  /** @type {HTMLFormElement} */
  const askForm = document.getElementById('ask-form');
  /** @type {HTMLInputElement} */
  const askAuthorInput = document.getElementById('ask-author');
  /** @type {HTMLInputElement} */
  const askTitleInput = document.getElementById('ask-title');
  /** @type {HTMLTextAreaElement} */
  const askBodyInput = document.getElementById('ask-body');
  /** @type {HTMLInputElement} */
  const searchInput = document.getElementById('search-input');
  /** @type {HTMLSelectElement} */
  const sortSelect = document.getElementById('sort-select');
  /** @type {HTMLUListElement} */
  const questionList = document.getElementById('question-list');
  /** @type {HTMLElement} */
  const emptyState = document.getElementById('empty-state');

  /** @typedef {{id:string,title:string,body:string,author:string,createdAt:number,answers:Answer[]}} Question */
  /** @typedef {{id:string,body:string,author:string,createdAt:number}} Answer */

  /**
   * Util functions
   */
  const now = () => Date.now();
  const byNewest = (a, b) => b.createdAt - a.createdAt;
  const byOldest = (a, b) => a.createdAt - b.createdAt;
  const byMostAnswers = (a, b) => (b.answers?.length || 0) - (a.answers?.length || 0);
  const formatDate = (ts) => new Date(ts).toLocaleString();
  const uid = (prefix) => `${prefix}_${Math.random().toString(36).slice(2, 8)}_${Date.now().toString(36)}`;

  function loadQuestions() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const data = JSON.parse(raw);
      if (!Array.isArray(data)) return [];
      return data.map((q) => ({ ...q, answers: Array.isArray(q.answers) ? q.answers : [] }));
    } catch (e) {
      console.error('Failed to load questions', e);
      return [];
    }
  }

  /**
   * @param {Question[]} questions
   */
  function saveQuestions(questions) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(questions));
    } catch (e) {
      console.error('Failed to save questions', e);
    }
  }

  /**
   * Render
   */
  function render() {
    const keyword = (searchInput?.value || '').trim().toLowerCase();
    const sort = sortSelect?.value || 'newest';
    const questions = applySort(filterByKeyword(loadQuestions(), keyword), sort);

    questionList.innerHTML = '';

    if (questions.length === 0) {
      emptyState.hidden = false;
      return;
    }
    emptyState.hidden = true;

    for (const q of questions) {
      const li = document.createElement('li');
      li.className = 'question-item';
      li.dataset.id = q.id;

      const head = document.createElement('div');
      head.className = 'question-head';

      const title = document.createElement('h3');
      title.className = 'question-title';
      title.textContent = q.title;

      const right = document.createElement('div');
      right.style.display = 'flex';
      right.style.gap = '8px';
      right.style.alignItems = 'center';

      const stats = document.createElement('div');
      stats.className = 'question-stats';
      stats.innerHTML = `<span class="question-meta">작성자 ${escapeHTML(q.author)} · ${formatDate(q.createdAt)}</span> · <span>답변 ${q.answers.length}</span>`;

      const expandBtn = document.createElement('button');
      expandBtn.className = 'expand-btn';
      expandBtn.type = 'button';
      expandBtn.textContent = '내용 보기';
      expandBtn.addEventListener('click', () => {
        details.hidden = !details.hidden;
        expandBtn.textContent = details.hidden ? '내용 보기' : '내용 닫기';
      });

      right.appendChild(stats);
      right.appendChild(expandBtn);

      head.appendChild(title);
      head.appendChild(right);

      const details = document.createElement('div');
      details.hidden = true;

      const body = document.createElement('div');
      body.className = 'question-body';
      body.textContent = q.body;

      const controls = document.createElement('div');
      controls.className = 'question-controls';

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'btn btn-ghost';
      deleteBtn.type = 'button';
      deleteBtn.textContent = '삭제';
      deleteBtn.addEventListener('click', () => onDeleteQuestion(q.id));

      controls.appendChild(deleteBtn);

      const answers = document.createElement('div');
      answers.className = 'answers';

      const answersHeader = document.createElement('strong');
      answersHeader.textContent = `답변 (${q.answers.length})`;

      const answersWrap = document.createElement('div');
      for (const a of q.answers) {
        const ans = document.createElement('div');
        ans.className = 'answer';
        const meta = document.createElement('div');
        meta.className = 'answer-meta';
        meta.textContent = `${a.author} · ${formatDate(a.createdAt)}`;
        const body = document.createElement('div');
        body.className = 'answer-body';
        body.textContent = a.body;
        ans.appendChild(meta);
        ans.appendChild(body);
        answersWrap.appendChild(ans);
      }

      const answerForm = createAnswerForm(q.id);

      answers.appendChild(answersHeader);
      answers.appendChild(answersWrap);
      answers.appendChild(answerForm);

      details.appendChild(body);
      details.appendChild(controls);
      details.appendChild(answers);

      li.appendChild(head);
      li.appendChild(details);
      questionList.appendChild(li);
    }
  }

  /**
   * Escape helper
   */
  function escapeHTML(str) {
    return String(str).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function filterByKeyword(questions, keyword) {
    if (!keyword) return questions;
    return questions.filter((q) =>
      q.title.toLowerCase().includes(keyword) ||
      q.body.toLowerCase().includes(keyword) ||
      q.author.toLowerCase().includes(keyword)
    );
  }

  function applySort(questions, sort) {
    const copy = [...questions];
    if (sort === 'oldest') return copy.sort(byOldest);
    if (sort === 'mostAnswers') return copy.sort(byMostAnswers);
    return copy.sort(byNewest);
  }

  /**
   * Actions
   */
  function onCreateQuestion(e) {
    e.preventDefault();
    const author = askAuthorInput.value.trim();
    const title = askTitleInput.value.trim();
    const body = askBodyInput.value.trim();
    if (!author || !title || !body) return;

    const questions = loadQuestions();
    questions.push({ id: uid('q'), author, title, body, createdAt: now(), answers: [] });
    saveQuestions(questions);

    askForm.reset();
    render();
  }

  function onDeleteQuestion(id) {
    const ok = confirm('정말 이 질문을 삭제하시겠습니까?');
    if (!ok) return;
    const questions = loadQuestions().filter((q) => q.id !== id);
    saveQuestions(questions);
    render();
  }

  function createAnswerForm(questionId) {
    const form = document.createElement('form');
    form.className = 'answer-form';
    form.autocomplete = 'on';

    const row = document.createElement('div');
    row.className = 'answer-form-row';

    const author = document.createElement('input');
    author.type = 'text';
    author.placeholder = '작성자';
    author.required = true;

    const body = document.createElement('input');
    body.type = 'text';
    body.placeholder = '답변 내용';
    body.required = true;

    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'btn btn-primary';
    submit.textContent = '답변 등록';

    row.appendChild(author);
    row.appendChild(body);
    form.appendChild(row);
    form.appendChild(submit);

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const a = author.value.trim();
      const b = body.value.trim();
      if (!a || !b) return;
      const questions = loadQuestions();
      const target = questions.find((q) => q.id === questionId);
      if (!target) return;
      target.answers.push({ id: uid('a'), author: a, body: b, createdAt: now() });
      saveQuestions(questions);
      render();
    });

    return form;
  }

  function initDemoIfEmpty() {
    const qs = loadQuestions();
    if (qs.length > 0) return;
    const demo = [
      { id: uid('q'), title: '예시) 자바스크립트에서 배열 정렬은 어떻게 하나요?', body: 'sort 메서드 사용법과 주의할 점이 궁금합니다.', author: '홍길동', createdAt: now() - 86400000, answers: [
        { id: uid('a'), body: 'compare 함수를 넘겨 사용하는 것을 권장합니다.', author: '유저1', createdAt: now() - 86000000 },
        { id: uid('a'), body: '문자열 정렬 시 localeCompare를 고려해 보세요.', author: '유저2', createdAt: now() - 85000000 }
      ]},
      { id: uid('q'), title: 'CSS Grid와 Flex의 차이가 뭔가요?', body: '레이아웃을 만들 때 어떤 기준으로 선택해야 할까요?', author: '김코딩', createdAt: now() - 3600000, answers: [] }
    ];
    saveQuestions(demo);
  }

  function bindEvents() {
    askForm?.addEventListener('submit', onCreateQuestion);
    searchInput?.addEventListener('input', () => render());
    sortSelect?.addEventListener('change', () => render());
  }

  function init() {
    initDemoIfEmpty();
    bindEvents();
    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();


