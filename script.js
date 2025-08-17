(function () {
  /**
   * Firebase Firestore + Auth 기반 Q&A 게시판
   * 
   * 주요 기능:
   * - Google 로그인/로그아웃
   * - 질문 작성, 조회, 삭제
   * - 답변 작성, 조회
   * - 실시간 데이터 동기화
   * - 검색 및 정렬
   * 
   * 데이터 모델:
   * - Question: { id, title, body, author, authorId, createdAt, answerCount }
   * - Answer: { id, body, author, authorId, createdAt, questionId }
   */

  // ========================================
  // Firebase 모듈 가져오기
  // ========================================
  // window.firebaseApp에서 필요한 Firebase 함수들을 구조분해할당으로 가져옴
  const { 
    db,                    // Firestore 데이터베이스 인스턴스
    auth,                  // Authentication 인스턴스
    collection,            // 컬렉션 참조 생성
    addDoc,                // 문서 추가
    getDocs,               // 문서 조회
    deleteDoc,             // 문서 삭제
    doc,                   // 문서 참조 생성
    updateDoc,             // 문서 업데이트
    onSnapshot,            // 실시간 데이터 구독
    query,                 // 쿼리 생성
    orderBy,               // 정렬 조건
    where,                 // 필터링 조건
    serverTimestamp,       // 서버 타임스탬프
    signInWithPopup,       // 팝업 로그인
    GoogleAuthProvider,    // Google 인증 제공자
    signOut,               // 로그아웃
    onAuthStateChanged     // 인증 상태 변경 감지
  } = window.firebaseApp;

  // ========================================
  // DOM 요소 참조
  // ========================================
  // 질문 작성 폼 관련 요소들
  /** @type {HTMLFormElement} */
  const askForm = document.getElementById('ask-form');           // 질문 작성 폼
  /** @type {HTMLInputElement} */
  const askAuthorInput = document.getElementById('ask-author'); // 작성자 입력 필드
  /** @type {HTMLInputElement} */
  const askTitleInput = document.getElementById('ask-title');   // 제목 입력 필드
  /** @type {HTMLTextAreaElement} */
  const askBodyInput = document.getElementById('ask-body');     // 내용 입력 필드
  
  // 검색 및 정렬 관련 요소들
  /** @type {HTMLInputElement} */
  const searchInput = document.getElementById('search-input');   // 검색 입력 필드
  /** @type {HTMLSelectElement} */
  const sortSelect = document.getElementById('sort-select');     // 정렬 선택 드롭다운
  
  // 질문 목록 표시 관련 요소들
  /** @type {HTMLUListElement} */
  const questionList = document.getElementById('question-list'); // 질문 목록 컨테이너
  /** @type {HTMLElement} */
  const emptyState = document.getElementById('empty-state');     // 빈 상태 메시지
  
  // 인증 상태 표시 관련 요소들
  /** @type {HTMLElement} */
  const authStatus = document.getElementById('auth-status');    // 인증 상태 컨테이너
  /** @type {HTMLElement} */
  const userInfo = document.getElementById('user-info');        // 사용자 정보 표시 영역
  /** @type {HTMLElement} */
  const userName = document.getElementById('user-name');        // 사용자 이름 표시
  /** @type {HTMLButtonElement} */
  const loginBtn = document.getElementById('login-btn');        // 로그인 버튼
  /** @type {HTMLButtonElement} */
  const logoutBtn = document.getElementById('logout-btn');      // 로그아웃 버튼

  // ========================================
  // TypeScript 타입 정의
  // ========================================
  /** @typedef {{id:string,title:string,body:string,author:string,authorId:string,createdAt:number}} Question */
  /** @typedef {{id:string,body:string,author:string,authorId:string,createdAt:number,questionId:string}} Answer */

  // ========================================
  // 전역 상태 변수
  // ========================================
  let currentUser = null;              // 현재 로그인된 사용자 정보 (Firebase Auth User 객체)
  let unsubscribeQuestions = null;     // 질문 데이터 실시간 구독 해제 함수 (메모리 누수 방지용)

  // ========================================
  // 유틸리티 함수들
  // ========================================
  
  /**
   * 현재 시간을 밀리초로 반환
   * @returns {number} 현재 시간 (밀리초)
   */
  const now = () => Date.now();
  
  /**
   * 정렬 함수들 - Array.sort()에서 사용
   */
  const byNewest = (a, b) => b.createdAt - a.createdAt;           // 최신순 정렬
  const byOldest = (a, b) => a.createdAt - b.createdAt;           // 오래된순 정렬
  const byMostAnswers = (a, b) => (b.answerCount || 0) - (a.answerCount || 0); // 답변 많은순 정렬
  
  /**
   * 타임스탬프를 읽기 쉬운 날짜 문자열로 변환
   * @param {any} ts - 타임스탬프 (Date, Firestore Timestamp, number 등)
   * @returns {string} 포맷된 날짜 문자열
   */
  const formatDate = (ts) => {
    if (!ts) return '날짜 없음';
    
    // Firestore serverTimestamp()가 아직 처리되지 않은 경우
    if (ts.toDate) {
      return ts.toDate().toLocaleString();
    }
    
    // 일반 timestamp인 경우
    return new Date(ts).toLocaleString();
  };
  
  /**
   * 고유 ID 생성 (임시용)
   * @param {string} prefix - ID 접두사
   * @returns {string} 고유 ID
   */
  const uid = (prefix) => `${prefix}_${Math.random().toString(36).slice(2, 8)}_${Date.now().toString(36)}`;

  // ========================================
  // 인증 관련 함수들
  // ========================================
  
  /**
   * 사용자 인증 상태에 따라 UI 업데이트
   * @param {Object|null} user - Firebase Auth User 객체 (로그아웃 시 null)
   */
  function updateAuthUI(user) {
    // 전역 상태 업데이트
    currentUser = user;
    
    if (user) {
      // ===== 로그인된 상태 =====
      // 사용자 정보 표시
      userInfo.hidden = false;
      loginBtn.hidden = true;
      userName.textContent = user.displayName || user.email || '사용자';
      
      // 질문 작성 폼의 작성자 필드 자동 설정
      askAuthorInput.value = user.displayName || user.email || '';
      askAuthorInput.readOnly = true;  // 로그인된 사용자는 작성자 변경 불가
    } else {
      // ===== 로그아웃된 상태 =====
      // 사용자 정보 숨김
      userInfo.hidden = true;
      loginBtn.hidden = false;
      
      // 질문 작성 폼 초기화
      askAuthorInput.value = '';
      askAuthorInput.readOnly = false;  // 로그아웃된 사용자는 작성자 입력 가능
    }
  }

  /**
   * Google 계정으로 로그인
   * Firebase Auth의 팝업 방식 로그인 사용
   */
  async function signInWithGoogle() {
    try {
      // Google 인증 제공자 생성
      const provider = new GoogleAuthProvider();
      
      // 팝업으로 로그인 시도
      await signInWithPopup(auth, provider);
      
      // 성공 시 updateAuthUI()가 자동으로 호출됨 (onAuthStateChanged에서)
      
    } catch (error) {
      console.error('Google 로그인 실패:', error);
      
      // ===== 사용자 친화적인 에러 메시지 제공 =====
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
      
      // 사용자에게 에러 메시지 표시
      alert(errorMessage);
    }
  }

  /**
   * 사용자 로그아웃
   * Firebase Auth에서 로그아웃 처리
   */
  async function signOutUser() {
    try {
      // Firebase Auth에서 로그아웃
      await signOut(auth);
      
      // 성공 시 updateAuthUI()가 자동으로 호출됨 (onAuthStateChanged에서)
      
    } catch (error) {
      console.error('로그아웃 실패:', error);
      alert('로그아웃에 실패했습니다: ' + error.message);
    }
  }

  // ========================================
  // Firestore 데이터 조작 함수들
  // ========================================
  
  /**
   * Firestore에서 모든 질문 데이터를 한 번에 로드
   * @returns {Promise<Array>} 질문 배열
   */
  async function loadQuestions() {
    try {
      // questions 컬렉션 참조 생성
      const questionsRef = collection(db, 'questions');
      
      // 생성일 기준 내림차순 정렬 쿼리 생성
      const q = query(questionsRef, orderBy('createdAt', 'desc'));
      
      // 쿼리 실행하여 스냅샷 가져오기
      const snapshot = await getDocs(q);
      
      // 스냅샷을 배열로 변환
      const questions = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        questions.push({
          id: doc.id,                    // 문서 ID
          ...data,                       // 모든 필드 데이터
          answerCount: data.answerCount || 0  // 답변 수 (기본값 0)
        });
      });
      
      return questions;
      
    } catch (e) {
      console.error('Failed to load questions', e);
      return [];  // 에러 시 빈 배열 반환
    }
  }

  /**
   * 새로운 질문을 Firestore에 저장
   * @param {Object} questionData - 질문 데이터 {author, title, body}
   * @returns {Promise<string>} 생성된 질문의 문서 ID
   */
  async function saveQuestion(questionData) {
    try {
      // 로그인 상태 확인
      if (!currentUser) {
        throw new Error('로그인이 필요합니다.');
      }

      // questions 컬렉션에 새 문서 추가
      const questionsRef = collection(db, 'questions');
      const docRef = await addDoc(questionsRef, {
        ...questionData,                    // 사용자 입력 데이터 (author, title, body)
        authorId: currentUser.uid,          // 현재 로그인한 사용자의 고유 ID
        createdAt: serverTimestamp(),       // 서버에서 생성된 타임스탬프 (정확한 시간)
        answerCount: 0                      // 초기 답변 수는 0
      });
      
      return docRef.id;  // 생성된 문서의 ID 반환
      
    } catch (e) {
      console.error('Failed to save question', e);
      throw e;  // 에러를 상위로 전파하여 UI에서 처리
    }
  }

  /**
   * 질문과 관련된 모든 답변을 삭제
   * @param {string} questionId - 삭제할 질문의 ID
   */
  async function deleteQuestion(questionId) {
    try {
      // 로그인 상태 확인
      if (!currentUser) {
        throw new Error('로그인이 필요합니다.');
      }

      // ===== 권한 확인: 자신이 작성한 질문만 삭제 가능 =====
      const questionRef = doc(db, 'questions', questionId);
      
      // 질문 데이터를 조회하여 작성자 확인
      const questionDoc = await getDocs(query(collection(db, 'questions'), where('__name__', '==', questionId)));
      
      if (!questionDoc.empty) {
        const questionData = questionDoc.docs[0].data();
        if (questionData.authorId !== currentUser.uid) {
          throw new Error('자신이 작성한 질문만 삭제할 수 있습니다.');
        }
      }

      // ===== 연관 데이터 삭제: 질문과 관련된 모든 답변 삭제 =====
      const answersRef = collection(db, 'answers');
      const answersQuery = query(answersRef, where('questionId', '==', questionId));
      const answersSnapshot = await getDocs(answersQuery);
      
      // 모든 답변을 병렬로 삭제 (Promise.all 사용)
      const deletePromises = answersSnapshot.docs.map(doc => deleteDoc(doc.ref));
      await Promise.all(deletePromises);

      // 마지막으로 질문 자체 삭제
      await deleteDoc(questionRef);
      
    } catch (e) {
      console.error('Failed to delete question', e);
      throw e;
    }
  }

  /**
   * 새로운 답변을 Firestore에 추가
   * 답변은 별도의 'answers' 컬렉션에 저장하여 serverTimestamp() 사용 가능
   * @param {string} questionId - 답변이 속한 질문의 ID
   * @param {Object} answerData - 답변 데이터 {author, body}
   */
  async function addAnswer(questionId, answerData) {
    try {
      // 로그인 상태 확인
      if (!currentUser) {
        throw new Error('로그인이 필요합니다.');
      }

      // ===== 1단계: 답변을 별도 컬렉션에 저장 =====
      const answersRef = collection(db, 'answers');
      const newAnswer = {
        ...answerData,                    // 사용자 입력 데이터 (author, body)
        questionId: questionId,           // 어떤 질문에 대한 답변인지 연결
        authorId: currentUser.uid,        // 답변 작성자의 고유 ID
        createdAt: serverTimestamp()      // 서버에서 생성된 타임스탬프 (정확한 시간)
      };
      
      // answers 컬렉션에 새 문서 추가
      await addDoc(answersRef, newAnswer);

      // ===== 2단계: 질문의 답변 수 업데이트 =====
      const questionRef = doc(db, 'questions', questionId);
      
      // 현재 질문 데이터 조회
      const questionDoc = await getDocs(query(collection(db, 'questions'), where('__name__', '==', questionId)));
      
      if (!questionDoc.empty) {
        const questionData = questionDoc.docs[0].data();
        const currentAnswerCount = questionData.answerCount || 0;
        
        // 답변 수를 1 증가시켜 업데이트
        await updateDoc(questionRef, { answerCount: currentAnswerCount + 1 });
      }

      // ===== 3단계: 화면 즉시 업데이트 =====
      // 답변 추가 후 실시간 데이터 구독을 재시작하여 화면에 반영
      subscribeToQuestions();
      
    } catch (e) {
      console.error('Failed to add answer', e);
      throw e;
    }
  }

  /**
   * 특정 질문에 대한 모든 답변을 Firestore에서 로드
   * @param {string} questionId - 답변을 가져올 질문의 ID
   * @returns {Promise<Array>} 답변 배열 (시간순 정렬됨)
   */
  async function loadAnswers(questionId) {
    try {
      // answers 컬렉션에서 특정 질문의 답변만 필터링
      const answersRef = collection(db, 'answers');
      
      // ⚠️ 임시 해결책: orderBy 제거하여 Firestore 인덱스 없이 쿼리
      // 원래: orderBy('createdAt', 'asc') 포함
      const q = query(answersRef, where('questionId', '==', questionId));
      const snapshot = await getDocs(q);
      
      // 스냅샷을 배열로 변환
      const answers = [];
      snapshot.forEach((doc) => {
        answers.push({
          id: doc.id,        // 답변 문서의 고유 ID
          ...doc.data()      // 모든 필드 데이터
        });
      });
      
      // ===== 클라이언트에서 정렬 (Firestore 인덱스 불필요) =====
      answers.sort((a, b) => {
        // Firestore Timestamp 객체를 Date로 변환하거나 일반 timestamp 사용
        const aTime = a.createdAt?.toDate?.() || a.createdAt || 0;
        const bTime = b.createdAt?.toDate?.() || b.createdAt || 0;
        return aTime - bTime;  // 오름차순 정렬 (오래된 답변부터)
      });
      
      // 디버깅: 답변 로딩 상태 확인
      console.log(`Question ${questionId}의 답변 ${answers.length}개 로드됨:`, answers);
      
      return answers;
      
    } catch (e) {
      console.error('Failed to load answers', e);
      return [];  // 에러 시 빈 배열 반환
    }
  }

    /**
   * 질문 데이터의 실시간 변경사항을 구독하고 화면에 반영
   * Firestore의 onSnapshot을 사용하여 실시간 동기화
   */
  function subscribeToQuestions() {
    // 이전 구독이 있다면 해제 (메모리 누수 방지)
    if (unsubscribeQuestions) {
      unsubscribeQuestions();
    }

    // questions 컬렉션 참조 및 쿼리 생성
    const questionsRef = collection(db, 'questions');
    const q = query(questionsRef, orderBy('createdAt', 'desc'));  // 최신 질문부터
    
    // 실시간 데이터 구독 시작
    unsubscribeQuestions = onSnapshot(q, (snapshot) => {
      console.log('🔥 질문 데이터 변경 감지:', snapshot.docs.length, '개');
      
      // ===== 1단계: 각 질문에 대한 답변을 비동기로 로드 =====
      const questions = [];
      const loadAnswersPromises = snapshot.docs.map(async (doc) => {
        const data = doc.data();
        console.log(`📝 질문 ${doc.id} 데이터:`, data);
        
        // 각 질문에 대한 답변을 별도 컬렉션에서 로드
        const answers = await loadAnswers(doc.id);
        console.log(`💬 질문 ${doc.id}의 답변 ${answers.length}개 로드 완료`);
        
        // 질문과 답변을 하나의 객체로 결합
        return {
          id: doc.id,
          ...data,                    // 질문 데이터
          answers: answers,           // 답변 배열
          answerCount: answers.length // 답변 수
        };
      });
      
      // ===== 2단계: 모든 답변 로딩 완료 후 화면 렌더링 =====
      Promise.all(loadAnswersPromises).then((questionsWithAnswers) => {
        console.log('🎯 모든 질문과 답변 로딩 완료:', questionsWithAnswers);
        renderQuestions(questionsWithAnswers);
        
      }).catch((error) => {
        console.error('❌ 답변 로딩 실패:', error);
        
        // ===== 3단계: 에러 발생 시 대체 처리 =====
        // Firestore 인덱스 에러인 경우 특별 처리
        if (error.message.includes('index') || error.message.includes('Index')) {
          console.warn('⚠️ Firestore 인덱스가 아직 생성 중입니다. 기본 데이터로 렌더링합니다.');
        }
        
        // 에러가 발생해도 기본 질문 데이터는 렌더링 (답변 없이)
        const basicQuestions = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
          answers: [],        // 답변은 빈 배열
          answerCount: 0     // 답변 수는 0
        }));
        console.log('⚠️ 기본 질문 데이터로 렌더링:', basicQuestions);
        renderQuestions(basicQuestions);
      });
      
    }, (error) => {
      // 구독 자체가 실패한 경우
      console.error('❌ 질문 구독 실패:', error);
    });

    // 구독 해제 함수 반환 (메모리 누수 방지)
    return unsubscribeQuestions;
  }

  // ========================================
  // UI 렌더링 함수들
  // ========================================
  
  /**
   * 질문 목록을 화면에 렌더링
   * 검색, 정렬, 필터링을 적용하여 사용자에게 표시
   * @param {Array} questions - 렌더링할 질문 배열
   */
  function renderQuestions(questions) {
    // ===== 1단계: 검색 및 정렬 적용 =====
    const keyword = (searchInput?.value || '').trim().toLowerCase();  // 검색어
    const sort = sortSelect?.value || 'newest';                       // 정렬 방식
    const filteredQuestions = applySort(filterByKeyword(questions, keyword), sort);

    // ===== 2단계: 기존 내용 초기화 =====
    questionList.innerHTML = '';

    // ===== 3단계: 빈 상태 처리 =====
    if (filteredQuestions.length === 0) {
      emptyState.hidden = false;  // "질문이 없습니다" 메시지 표시
      return;
    }
    emptyState.hidden = true;     // 빈 상태 메시지 숨김

    // ===== 4단계: 각 질문을 순회하며 DOM 요소 생성 =====
    for (const q of filteredQuestions) {
      // 질문 항목의 최상위 컨테이너 (li 요소)
      const li = document.createElement('li');
      li.className = 'question-item';
      li.dataset.id = q.id;  // 데이터 속성으로 질문 ID 저장

      // ===== 질문 헤더 영역 생성 =====
      const head = document.createElement('div');
      head.className = 'question-head';

      // 질문 제목
      const title = document.createElement('h3');
      title.className = 'question-title';
      title.textContent = q.title;

      // ===== 우측 영역 (통계 + 버튼) =====
      const right = document.createElement('div');
      right.style.display = 'flex';
      right.style.gap = '8px';
      right.style.alignItems = 'center';

      // 질문 통계 정보 (작성자, 작성일, 답변 수)
      const stats = document.createElement('div');
      stats.className = 'question-stats';
      stats.innerHTML = `<span class="question-meta">작성자 ${escapeHTML(q.author)} · ${formatDate(q.createdAt)}</span> · <span>답변 ${q.answers.length}</span>`;

      // 내용 보기/숨기기 토글 버튼
      const expandBtn = document.createElement('button');
      expandBtn.className = 'expand-btn';
      expandBtn.type = 'button';
      expandBtn.textContent = '내용 보기';
      expandBtn.addEventListener('click', () => {
        // details 영역의 표시/숨김 토글
        details.hidden = !details.hidden;
        expandBtn.textContent = details.hidden ? '내용 보기' : '내용 닫기';
      });

      // 우측 영역에 요소들 추가
      right.appendChild(stats);
      right.appendChild(expandBtn);

      // 헤더에 제목과 우측 영역 추가
      head.appendChild(title);
      head.appendChild(right);

      // ===== 질문 상세 내용 영역 생성 =====
      const details = document.createElement('div');
      details.hidden = true;  // 초기에는 숨김 상태

      // 질문 본문 내용
      const body = document.createElement('div');
      body.className = 'question-body';
      body.textContent = q.body;

      // ===== 질문 제어 버튼 영역 =====
      const controls = document.createElement('div');
      controls.className = 'question-controls';

      // 권한 확인: 자신이 작성한 질문만 삭제 버튼 표시
      if (currentUser && q.authorId === currentUser.uid) {
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn btn-ghost';
        deleteBtn.type = 'button';
        deleteBtn.textContent = '삭제';
        deleteBtn.addEventListener('click', () => onDeleteQuestion(q.id));
        controls.appendChild(deleteBtn);
      }

      // ===== 답변 영역 생성 =====
      const answers = document.createElement('div');
      answers.className = 'answers';

      // 답변 헤더 (답변 수 표시)
      const answersHeader = document.createElement('strong');
      answersHeader.textContent = `답변 (${q.answers.length})`;

      // 답변 목록을 담을 컨테이너
      const answersWrap = document.createElement('div');
      
      // 디버깅: 답변 데이터 확인
      console.log(`Question ${q.id}의 답변 데이터:`, q.answers);
      
      if (q.answers && q.answers.length > 0) {
        // ===== 답변이 있는 경우: 각 답변을 순회하며 렌더링 =====
        for (const a of q.answers) {
          console.log('답변 렌더링 중:', a);
          
          // 개별 답변 컨테이너
          const ans = document.createElement('div');
          ans.className = 'answer';
          
          // 답변 메타 정보 (작성자, 작성일)
          const meta = document.createElement('div');
          meta.className = 'answer-meta';
          meta.textContent = `${a.author || '작성자 없음'} · ${formatDate(a.createdAt)}`;
          
          // 답변 본문 내용
          const body = document.createElement('div');
          body.className = 'answer-body';
          body.textContent = a.body || '내용 없음';
          
          // 답변 요소에 메타와 본문 추가
          ans.appendChild(meta);
          ans.appendChild(body);
          answersWrap.appendChild(ans);
        }
      } else {
        // ===== 답변이 없는 경우: 안내 메시지 표시 =====
        const noAnswerMsg = document.createElement('div');
        noAnswerMsg.className = 'no-answer';
        noAnswerMsg.textContent = '아직 답변이 없습니다.';
        noAnswerMsg.style.color = '#666';
        noAnswerMsg.style.fontStyle = 'italic';
        noAnswerMsg.style.padding = '12px';
        noAnswerMsg.style.textAlign = 'center';
        answersWrap.appendChild(noAnswerMsg);
      }

      // ===== 답변 작성 폼 생성 =====
      const answerForm = createAnswerForm(q.id);

      // 답변 영역에 모든 요소들을 순서대로 추가
      answers.appendChild(answersHeader);    // 답변 헤더
      answers.appendChild(answersWrap);      // 답변 목록
      answers.appendChild(answerForm);       // 답변 작성 폼

      // 상세 내용 영역에 모든 요소들을 순서대로 추가
      details.appendChild(body);             // 질문 본문
      details.appendChild(controls);         // 제어 버튼
      details.appendChild(answers);          // 답변 영역

      // 질문 항목에 헤더와 상세 내용 추가
      li.appendChild(head);
      li.appendChild(details);
      
      // 질문 목록에 완성된 질문 항목 추가
      questionList.appendChild(li);
    }
  }

  // ========================================
  // 데이터 처리 및 유틸리티 함수들
  // ========================================
  
  /**
   * HTML 특수문자를 이스케이프하여 XSS 공격 방지
   * @param {string} str - 이스케이프할 문자열
   * @returns {string} 이스케이프된 문자열
   */
  function escapeHTML(str) {
    return String(str).replace(/[&<>"]/g, (c) => ({ 
      '&': '&amp;', 
      '<': '&lt;', 
      '>': '&gt;', 
      '"': '&quot;' 
    }[c]));
  }

  /**
   * 검색어를 기준으로 질문을 필터링
   * @param {Array} questions - 필터링할 질문 배열
   * @param {string} keyword - 검색 키워드
   * @returns {Array} 필터링된 질문 배열
   */
  function filterByKeyword(questions, keyword) {
    if (!keyword) return questions;  // 검색어가 없으면 모든 질문 반환
    
    return questions.filter((q) =>
      q.title.toLowerCase().includes(keyword) ||    // 제목에서 검색
      q.body.toLowerCase().includes(keyword) ||     // 내용에서 검색
      q.author.toLowerCase().includes(keyword)      // 작성자에서 검색
    );
  }

  /**
   * 질문 배열을 지정된 기준에 따라 정렬
   * @param {Array} questions - 정렬할 질문 배열
   * @param {string} sort - 정렬 방식 ('newest', 'oldest', 'mostAnswers')
   * @returns {Array} 정렬된 질문 배열
   */
  function applySort(questions, sort) {
    const copy = [...questions];  // 원본 배열 복사 (불변성 유지)
    
    if (sort === 'oldest') return copy.sort(byOldest);           // 오래된순
    if (sort === 'mostAnswers') return copy.sort(byMostAnswers); // 답변 많은순
    return copy.sort(byNewest);                                  // 기본값: 최신순
  }

  // ========================================
  // 사용자 액션 처리 함수들
  // ========================================
  
  /**
   * 새 질문 작성 폼 제출 처리
   * @param {Event} e - 폼 제출 이벤트
   */
  async function onCreateQuestion(e) {
    e.preventDefault();  // 기본 폼 제출 동작 방지
    
    // 로그인 상태 확인
    if (!currentUser) {
      alert('질문을 작성하려면 로그인이 필요합니다.');
      return;
    }

    // ===== 1단계: 폼 데이터 검증 =====
    const author = askAuthorInput.value.trim();
    const title = askTitleInput.value.trim();
    const body = askBodyInput.value.trim();
    
    // 필수 필드 검증
    if (!author || !title || !body) return;

    try {
      // ===== 2단계: 질문 데이터 객체 생성 =====
      const questionData = {
        author,    // 작성자
        title,     // 제목
        body       // 내용
      };

      // ===== 3단계: Firestore에 질문 저장 =====
      await saveQuestion(questionData);
      
      // ===== 4단계: 폼 초기화 =====
      askForm.reset();
      
      // 로그인된 사용자의 경우 작성자 필드 자동 설정
      askAuthorInput.value = currentUser.displayName || currentUser.email || '';
      
    } catch (error) {
      alert('질문 등록에 실패했습니다: ' + error.message);
    }
  }

  /**
   * 질문 삭제 처리
   * @param {string} id - 삭제할 질문의 ID
   */
  async function onDeleteQuestion(id) {
    // 사용자 확인 대화상자
    const ok = confirm('정말 이 질문을 삭제하시겠습니까?');
    if (!ok) return;  // 취소 시 함수 종료

    try {
      // Firestore에서 질문 및 관련 답변 삭제
      await deleteQuestion(id);
      
      // 성공 시 화면이 자동으로 업데이트됨 (subscribeToQuestions에서)
      
    } catch (error) {
      alert('질문 삭제에 실패했습니다: ' + error.message);
    }
  }

  /**
   * 답변 작성 폼을 동적으로 생성
   * @param {string} questionId - 답변이 속할 질문의 ID
   * @returns {HTMLFormElement} 생성된 답변 작성 폼
   */
  function createAnswerForm(questionId) {
    // ===== 1단계: 폼 컨테이너 생성 =====
    const form = document.createElement('form');
    form.className = 'answer-form';
    form.autocomplete = 'on';

    // ===== 2단계: 입력 필드들을 담을 행 생성 =====
    const row = document.createElement('div');
    row.className = 'answer-form-row';

    // ===== 3단계: 작성자 입력 필드 생성 =====
    const author = document.createElement('input');
    author.type = 'text';
    author.placeholder = '작성자';
    author.required = true;
    
    // 로그인된 사용자의 경우 자동 설정 및 읽기 전용
    if (currentUser) {
      author.value = currentUser.displayName || currentUser.email || '';
      author.readOnly = true;  // 로그인된 사용자는 작성자 변경 불가
    }

    // ===== 4단계: 답변 내용 입력 필드 생성 =====
    const body = document.createElement('input');
    body.type = 'text';
    body.placeholder = '답변 내용';
    body.required = true;

    // ===== 5단계: 제출 버튼 생성 =====
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'btn btn-primary';
    submit.textContent = '답변 등록';

    // ===== 6단계: DOM 구조 구성 =====
    row.appendChild(author);
    row.appendChild(body);
    form.appendChild(row);
    form.appendChild(submit);

    // ===== 7단계: 폼 제출 이벤트 리스너 등록 =====
    form.addEventListener('submit', async (e) => {
      e.preventDefault();  // 기본 폼 제출 동작 방지
      
      // 로그인 상태 확인
      if (!currentUser) {
        alert('답변을 작성하려면 로그인이 필요합니다.');
        return;
      }

      // ===== 폼 데이터 검증 =====
      const a = author.value.trim();
      const b = body.value.trim();
      if (!a || !b) return;  // 필수 필드 검증

      try {
        // ===== 답변 데이터 객체 생성 =====
        const answerData = {
          id: uid('a'),    // 고유 ID 생성 (임시용)
          author: a,       // 작성자
          body: b          // 답변 내용
        };

        // ===== Firestore에 답변 저장 =====
        await addAnswer(questionId, answerData);
        
        // ===== 폼 초기화 =====
        form.reset();
        
        // 로그인된 사용자의 경우 작성자 필드 자동 설정
        if (currentUser) {
          author.value = currentUser.displayName || currentUser.email || '';
        }
        
      } catch (error) {
        alert('답변 등록에 실패했습니다: ' + error.message);
      }
    });

    return form;
  }

  // ========================================
  // 이벤트 바인딩 및 초기화
  // ========================================
  
  /**
   * 모든 DOM 요소에 이벤트 리스너를 등록
   * 사용자 상호작용을 처리하는 함수들을 연결
   */
  function bindEvents() {
    // ===== 질문 작성 폼 이벤트 =====
    askForm?.addEventListener('submit', onCreateQuestion);
    
    // ===== 검색 및 정렬 이벤트 =====
    searchInput?.addEventListener('input', () => {
      // 실시간 검색: 입력할 때마다 전체 데이터를 다시 렌더링
      subscribeToQuestions();
    });
    
    sortSelect?.addEventListener('change', () => {
      // 정렬 변경: 선택할 때마다 전체 데이터를 다시 렌더링
      subscribeToQuestions();
    });
    
    // ===== 인증 관련 이벤트 =====
    loginBtn?.addEventListener('click', signInWithGoogle);
    logoutBtn?.addEventListener('click', signOutUser);
  }

  /**
   * 애플리케이션 초기화 함수
   * 이벤트 바인딩과 Firebase 인증 상태 감지를 설정
   */
  function init() {
    // ===== 1단계: 모든 이벤트 리스너 등록 =====
    bindEvents();
    
    // ===== 2단계: Firebase 인증 상태 변경 감지 설정 =====
    onAuthStateChanged(auth, (user) => {
      // 사용자 인증 상태가 변경될 때마다 호출됨
      updateAuthUI(user);  // UI 업데이트
      
      // 실시간 데이터 구독 시작 (로그인/로그아웃 상태와 관계없이)
      subscribeToQuestions();
    });
  }

  // ===== 3단계: DOM 로딩 완료 시점에 초기화 실행 =====
  if (document.readyState === 'loading') {
    // DOM이 아직 로딩 중인 경우: DOMContentLoaded 이벤트 대기
    document.addEventListener('DOMContentLoaded', init);
  } else {
    // DOM이 이미 로딩 완료된 경우: 즉시 초기화 실행
    init();
  }
})();

