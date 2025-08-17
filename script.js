(function () {
  /**
   * Firebase Firestore + Auth 기반 Q&A 게시판
   * 데이터 모델
   * Question: { id, title, body, author, authorId, createdAt }
   * Answer: { id, body, author, authorId, createdAt, questionId }
   */

  // Firebase 인스턴스 가져오기
  const { 
    db, 
    auth,
    collection, 
    addDoc, 
    getDocs, 
    deleteDoc, 
    doc, 
    updateDoc, 
    onSnapshot, 
    query, 
    orderBy, 
    where,
    serverTimestamp,
    signInWithPopup,
    GoogleAuthProvider,
    signOut,
    onAuthStateChanged
  } = window.firebaseApp;

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
  /** @type {HTMLElement} */
  const authStatus = document.getElementById('auth-status');
  /** @type {HTMLElement} */
  const userInfo = document.getElementById('user-info');
  /** @type {HTMLElement} */
  const userName = document.getElementById('user-name');
  /** @type {HTMLButtonElement} */
  const loginBtn = document.getElementById('login-btn');
  /** @type {HTMLButtonElement} */
  const logoutBtn = document.getElementById('logout-btn');

  /** @typedef {{id:string,title:string,body:string,author:string,authorId:string,createdAt:number}} Question */
  /** @typedef {{id:string,body:string,author:string,authorId:string,createdAt:number,questionId:string}} Answer */

  let currentUser = null;
  let unsubscribeQuestions = null;

  /**
   * Util functions
   */
  const now = () => Date.now();
  const byNewest = (a, b) => b.createdAt - a.createdAt;
  const byOldest = (a, b) => a.createdAt - b.createdAt;
  const byMostAnswers = (a, b) => (b.answerCount || 0) - (a.answerCount || 0);
  const formatDate = (ts) => {
    if (!ts) return '날짜 없음';
    // serverTimestamp()가 아직 처리되지 않은 경우
    if (ts.toDate) {
      return ts.toDate().toLocaleString();
    }
    // 일반 timestamp인 경우
    return new Date(ts).toLocaleString();
  };
  const uid = (prefix) => `${prefix}_${Math.random().toString(36).slice(2, 8)}_${Date.now().toString(36)}`;

  /**
   * 인증 상태 관리
   */
  function updateAuthUI(user) {
    currentUser = user;
    
    if (user) {
      // 로그인된 상태
      userInfo.hidden = false;
      loginBtn.hidden = true;
      userName.textContent = user.displayName || user.email || '사용자';
      
      // 작성자 필드 자동 설정
      askAuthorInput.value = user.displayName || user.email || '';
      askAuthorInput.readOnly = true;
    } else {
      // 로그아웃된 상태
      userInfo.hidden = true;
      loginBtn.hidden = false;
      
      // 작성자 필드 초기화
      askAuthorInput.value = '';
      askAuthorInput.readOnly = false;
    }
  }

  /**
   * Google 로그인
   */
  async function signInWithGoogle() {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error('Google 로그인 실패:', error);
      
      // 구체적인 에러 메시지 제공
      let errorMessage = '로그인에 실패했습니다.';
      
      switch (error.code) {
        case 'auth/unauthorized-domain':
          errorMessage = '현재 도메인에서 로그인이 허용되지 않습니다. Firebase 콘솔에서 도메인을 승인해주세요.';
          break;
        case 'auth/configuration-not-found':
          errorMessage = 'Firebase Authentication이 설정되지 않았습니다.';
          break;
        case 'auth/popup-blocked':
          errorMessage = '팝업이 차단되었습니다. 브라우저에서 팝업을 허용해주세요.';
          break;
        case 'auth/cancelled-popup-request':
          errorMessage = '로그인이 취소되었습니다.';
          break;
        case 'auth/network-request-failed':
          errorMessage = '네트워크 연결을 확인하고 다시 시도해주세요.';
          break;
        default:
          errorMessage = `로그인 오류: ${error.message}`;
      }
      
      alert(errorMessage);
    }
  }

  /**
   * 로그아웃
   */
  async function signOutUser() {
    try {
      await signOut(auth);
    } catch (error) {
      console.error('로그아웃 실패:', error);
      alert('로그아웃에 실패했습니다: ' + error.message);
    }
  }

  /**
   * Firebase 데이터 로드
   */
  async function loadQuestions() {
    try {
      const questionsRef = collection(db, 'questions');
      const q = query(questionsRef, orderBy('createdAt', 'desc'));
      const snapshot = await getDocs(q);
      
      const questions = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        questions.push({
          id: doc.id,
          ...data,
          answerCount: data.answerCount || 0
        });
      });
      
      return questions;
    } catch (e) {
      console.error('Failed to load questions', e);
      return [];
    }
  }

  /**
   * Firebase에 질문 저장
   */
  async function saveQuestion(questionData) {
    try {
      if (!currentUser) {
        throw new Error('로그인이 필요합니다.');
      }

      const questionsRef = collection(db, 'questions');
      const docRef = await addDoc(questionsRef, {
        ...questionData,
        authorId: currentUser.uid,
        createdAt: serverTimestamp(),
        answerCount: 0
      });
      return docRef.id;
    } catch (e) {
      console.error('Failed to save question', e);
      throw e;
    }
  }

  /**
   * Firebase에서 질문 삭제
   */
  async function deleteQuestion(questionId) {
    try {
      if (!currentUser) {
        throw new Error('로그인이 필요합니다.');
      }

      // 자신이 작성한 질문만 삭제 가능
      const questionRef = doc(db, 'questions', questionId);
      const questionDoc = await getDocs(query(collection(db, 'questions'), where('__name__', '==', questionId)));
      
      if (!questionDoc.empty) {
        const questionData = questionDoc.docs[0].data();
        if (questionData.authorId !== currentUser.uid) {
          throw new Error('자신이 작성한 질문만 삭제할 수 있습니다.');
        }
      }

      // 질문과 관련된 모든 답변도 삭제
      const answersRef = collection(db, 'answers');
      const answersQuery = query(answersRef, where('questionId', '==', questionId));
      const answersSnapshot = await getDocs(answersQuery);
      
      const deletePromises = answersSnapshot.docs.map(doc => deleteDoc(doc.ref));
      await Promise.all(deletePromises);

      await deleteDoc(questionRef);
    } catch (e) {
      console.error('Failed to delete question', e);
      throw e;
    }
  }

  /**
   * Firebase에 답변 추가 (별도 컬렉션 사용)
   */
  async function addAnswer(questionId, answerData) {
    try {
      if (!currentUser) {
        throw new Error('로그인이 필요합니다.');
      }

      // 답변을 별도 컬렉션에 저장
      const answersRef = collection(db, 'answers');
      const newAnswer = {
        ...answerData,
        questionId: questionId,
        authorId: currentUser.uid,
        createdAt: serverTimestamp() // ✅ 이제 serverTimestamp() 사용 가능
      };
      
      await addDoc(answersRef, newAnswer);

      // 질문의 답변 수 업데이트
      const questionRef = doc(db, 'questions', questionId);
      const questionDoc = await getDocs(query(collection(db, 'questions'), where('__name__', '==', questionId)));
      
      if (!questionDoc.empty) {
        const questionData = questionDoc.docs[0].data();
        const currentAnswerCount = questionData.answerCount || 0;
        await updateDoc(questionRef, { answerCount: currentAnswerCount + 1 });
      }

      // ✅ 답변 추가 후 즉시 화면 업데이트를 위해 구독 재시작
      subscribeToQuestions();
    } catch (e) {
      console.error('Failed to add answer', e);
      throw e;
    }
  }

  /**
   * 질문에 대한 답변 로드
   */
  async function loadAnswers(questionId) {
    try {
      const answersRef = collection(db, 'answers');
      // ✅ 임시 해결책: orderBy 제거하여 인덱스 없이 쿼리
      const q = query(answersRef, where('questionId', '==', questionId));
      const snapshot = await getDocs(q);
      
      const answers = [];
      snapshot.forEach((doc) => {
        answers.push({
          id: doc.id,
          ...doc.data()
        });
      });
      
      // ✅ 클라이언트에서 정렬 (인덱스 불필요)
      answers.sort((a, b) => {
        const aTime = a.createdAt?.toDate?.() || a.createdAt || 0;
        const bTime = b.createdAt?.toDate?.() || b.createdAt || 0;
        return aTime - bTime;
      });
      
      // ✅ 디버깅 로그 추가
      console.log(`Question ${questionId}의 답변 ${answers.length}개 로드됨:`, answers);
      
      return answers;
    } catch (e) {
      console.error('Failed to load answers', e);
      return [];
    }
  }

  /**
   * 실시간 데이터 구독 (답변 포함)
   */
  function subscribeToQuestions() {
    if (unsubscribeQuestions) {
      unsubscribeQuestions();
    }

    const questionsRef = collection(db, 'questions');
    const q = query(questionsRef, orderBy('createdAt', 'desc'));
    
         unsubscribeQuestions = onSnapshot(q, (snapshot) => {
       console.log('🔥 질문 데이터 변경 감지:', snapshot.docs.length, '개');
       
       const questions = [];
       const loadAnswersPromises = snapshot.docs.map(async (doc) => {
         const data = doc.data();
         console.log(`📝 질문 ${doc.id} 데이터:`, data);
         
         // 각 질문에 대한 답변을 별도로 로드
         const answers = await loadAnswers(doc.id);
         console.log(`💬 질문 ${doc.id}의 답변 ${answers.length}개 로드 완료`);
         
         return {
           id: doc.id,
           ...data,
           answers: answers,
           answerCount: answers.length
         };
       });
       
       // 모든 답변 로딩이 완료된 후 렌더링
       Promise.all(loadAnswersPromises).then((questionsWithAnswers) => {
         console.log('🎯 모든 질문과 답변 로딩 완료:', questionsWithAnswers);
         renderQuestions(questionsWithAnswers);
       }).catch((error) => {
         console.error('❌ 답변 로딩 실패:', error);
         
         // ✅ 인덱스 에러인 경우 특별 처리
         if (error.message.includes('index') || error.message.includes('Index')) {
           console.warn('⚠️ Firestore 인덱스가 아직 생성 중입니다. 기본 데이터로 렌더링합니다.');
         }
         
         // 에러가 발생해도 기본 질문 데이터는 렌더링
         const basicQuestions = snapshot.docs.map(doc => ({
           id: doc.id,
           ...doc.data(),
           answers: [],
           answerCount: 0
         }));
         console.log('⚠️ 기본 질문 데이터로 렌더링:', basicQuestions);
         renderQuestions(basicQuestions);
       });
     }, (error) => {
       console.error('❌ 질문 구독 실패:', error);
     });

    return unsubscribeQuestions;
  }

  /**
   * 질문 렌더링
   */
  function renderQuestions(questions) {
    const keyword = (searchInput?.value || '').trim().toLowerCase();
    const sort = sortSelect?.value || 'newest';
    const filteredQuestions = applySort(filterByKeyword(questions, keyword), sort);

    questionList.innerHTML = '';

    if (filteredQuestions.length === 0) {
      emptyState.hidden = false;
      return;
    }
    emptyState.hidden = true;

    for (const q of filteredQuestions) {
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

      // 자신이 작성한 질문만 삭제 버튼 표시
      if (currentUser && q.authorId === currentUser.uid) {
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn btn-ghost';
        deleteBtn.type = 'button';
        deleteBtn.textContent = '삭제';
        deleteBtn.addEventListener('click', () => onDeleteQuestion(q.id));
        controls.appendChild(deleteBtn);
      }

      const answers = document.createElement('div');
      answers.className = 'answers';

      const answersHeader = document.createElement('strong');
      answersHeader.textContent = `답변 (${q.answers.length})`;

      const answersWrap = document.createElement('div');
      
      // ✅ 디버깅: 답변 데이터 확인
      console.log(`Question ${q.id}의 답변 데이터:`, q.answers);
      
      if (q.answers && q.answers.length > 0) {
        for (const a of q.answers) {
          console.log('답변 렌더링 중:', a);
          const ans = document.createElement('div');
          ans.className = 'answer';
          
          const meta = document.createElement('div');
          meta.className = 'answer-meta';
          meta.textContent = `${a.author || '작성자 없음'} · ${formatDate(a.createdAt)}`;
          
          const body = document.createElement('div');
          body.className = 'answer-body';
          body.textContent = a.body || '내용 없음';
          
          ans.appendChild(meta);
          ans.appendChild(body);
          answersWrap.appendChild(ans);
        }
      } else {
        // 답변이 없을 때 메시지 표시
        const noAnswerMsg = document.createElement('div');
        noAnswerMsg.className = 'no-answer';
        noAnswerMsg.textContent = '아직 답변이 없습니다.';
        noAnswerMsg.style.color = '#666';
        noAnswerMsg.style.fontStyle = 'italic';
        noAnswerMsg.style.padding = '12px';
        noAnswerMsg.style.textAlign = 'center';
        answersWrap.appendChild(noAnswerMsg);
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
  async function onCreateQuestion(e) {
    e.preventDefault();
    
    if (!currentUser) {
      alert('질문을 작성하려면 로그인이 필요합니다.');
      return;
    }

    const author = askAuthorInput.value.trim();
    const title = askTitleInput.value.trim();
    const body = askBodyInput.value.trim();
    if (!author || !title || !body) return;

    try {
      const questionData = {
        author,
        title,
        body
      };

      await saveQuestion(questionData);
      askForm.reset();
      askAuthorInput.value = currentUser.displayName || currentUser.email || '';
    } catch (error) {
      alert('질문 등록에 실패했습니다: ' + error.message);
    }
  }

  async function onDeleteQuestion(id) {
    const ok = confirm('정말 이 질문을 삭제하시겠습니까?');
    if (!ok) return;

    try {
      await deleteQuestion(id);
    } catch (error) {
      alert('질문 삭제에 실패했습니다: ' + error.message);
    }
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
    
    // 로그인된 사용자의 경우 자동 설정
    if (currentUser) {
      author.value = currentUser.displayName || currentUser.email || '';
      author.readOnly = true;
    }

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

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      if (!currentUser) {
        alert('답변을 작성하려면 로그인이 필요합니다.');
        return;
      }

      const a = author.value.trim();
      const b = body.value.trim();
      if (!a || !b) return;

      try {
        const answerData = {
          id: uid('a'),
          author: a,
          body: b
        };

        await addAnswer(questionId, answerData);
        form.reset();
        if (currentUser) {
          author.value = currentUser.displayName || currentUser.email || '';
        }
      } catch (error) {
        alert('답변 등록에 실패했습니다: ' + error.message);
      }
    });

    return form;
  }

  function bindEvents() {
    askForm?.addEventListener('submit', onCreateQuestion);
    searchInput?.addEventListener('input', () => {
      // 실시간 검색을 위해 전체 데이터를 다시 렌더링
      subscribeToQuestions();
    });
    sortSelect?.addEventListener('change', () => {
      // 실시간 정렬을 위해 전체 데이터를 다시 렌더링
      subscribeToQuestions();
    });
    
    // 인증 관련 이벤트
    loginBtn?.addEventListener('click', signInWithGoogle);
    logoutBtn?.addEventListener('click', signOutUser);
  }

  function init() {
    bindEvents();
    
    // 인증 상태 변경 감지
    onAuthStateChanged(auth, (user) => {
      updateAuthUI(user);
      
      // 실시간 데이터 구독 시작
      subscribeToQuestions();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

