// ==================== THEME DATA — first half of THEME_TABS ====================
var THEME_TABS = [
  // ---------- ГЛОБАЛНИ ----------
  { id: 'global', icon: '🎨', label: 'Глобални', description: 'Базови цветове и фонове, които се използват навсякъде в платформата.', groups: [
    { title: 'Основни фонове', icon: '🖥️', desc: 'Главни фонове на страницата, картите и панелите. Влияят на цялата платформа.', items: [
      { key: 'theme_bg', type: 'color', css: '--bg', def: '#0b151b', label: 'Основен фон на страницата', hint: 'Целия body — задният фон, който се вижда зад всичко' },
      { key: 'theme_bg_card', type: 'color', css: '--bg-card', def: '#1b2930', label: 'Фон на карти и панели', hint: 'Карти, панели, контейнери — заглавия и съдържание' },
      { key: 'theme_bg_elevated', type: 'color', css: '--bg-elevated', def: '#1e3040', label: 'Повдигнат фон', hint: 'Бутони, dropdown менюта, повдигнати елементи' },
      { key: 'theme_bg_hover', type: 'color', css: '--bg-hover', def: '#243848', label: 'Ховър ефект', hint: 'Когато курсорът мине върху интерактивен елемент' },
      { key: 'theme_bg_active', type: 'color', css: '--bg-active', def: '#2c4858', label: 'Активен елемент', hint: 'Натиснат бутон или активна опция' },
    ]},
    { title: 'Текст', icon: '✏️', desc: 'Цветове на текста — основен, вторичен и приглушен (за помощни надписи).', items: [
      { key: 'theme_text', type: 'color', css: '--text', def: '#e8ecee', label: 'Основен текст', hint: 'Главният текст в платформата — заглавия, съдържание' },
      { key: 'theme_text_secondary', type: 'color', css: '--text-secondary', def: '#8fa3b0', label: 'Вторичен текст', hint: 'Подзаглавия, метаданни, мета информация' },
      { key: 'theme_text_dim', type: 'color', css: '--text-dim', def: '#566d7a', label: 'Приглушен текст', hint: 'Дати, hints, неактивни елементи, placeholder' },
    ]},
    { title: 'Рамки', icon: '🔲', desc: 'Цветове на рамките около карти, бутони и контейнери.', items: [
      { key: 'theme_border', type: 'color', css: '--border', def: '#1e3040', label: 'Рамки', hint: 'Стандартна рамка около всичко — карти, инпути, бутони' },
      { key: 'theme_border_hover', type: 'color', css: '--border-hover', def: '#2c4858', label: 'Рамки при ховър', hint: 'Цвят на рамката, когато курсорът е върху елемент' },
    ]},
    { title: 'Акценти и линкове', icon: '💎', desc: 'Главни акцентни цветове за линкове, фокус и активни елементи.', items: [
      { key: 'theme_accent', type: 'color', css: '--accent', def: '#1cb0f6', label: 'Основен акцент', hint: 'Линкове, фокус ринг, селекции, активни икони' },
      { key: 'theme_accent_hover', type: 'color', css: '--accent-hover', def: '#3dc0ff', label: 'Акцент при ховър', hint: 'Когато курсорът е върху линк' },
    ]},
    { title: 'Статус цветове', icon: '🚦', desc: 'Цветове за състояния — успех, внимание, грешка, информация. Използват се в badges, индикатори, deadlines.', items: [
      { key: 'theme_green', type: 'color', css: '--green', def: '#22c55e', label: 'Зелено (успех)', hint: 'Завършени задачи, успешни действия' },
      { key: 'theme_yellow', type: 'color', css: '--yellow', def: '#eab308', label: 'Жълто (внимание)', hint: 'Предупреждения, наближаващи дедлайни' },
      { key: 'theme_red', type: 'color', css: '--red', def: '#ef4444', label: 'Червено (грешка)', hint: 'Грешки, просрочени задачи, опасни действия' },
      { key: 'theme_orange', type: 'color', css: '--orange', def: '#f97316', label: 'Оранжево', hint: 'Втори тон за внимание' },
      { key: 'theme_blue', type: 'color', css: '--blue', def: '#3b82f6', label: 'Синьо', hint: 'Информационни badges' },
      { key: 'theme_purple', type: 'color', css: '--purple', def: '#a855f7', label: 'Лилаво', hint: 'Допълнителен акцент за специални категории' },
      { key: 'theme_teal', type: 'color', css: '--teal', def: '#14b8a6', label: 'Тийл', hint: 'Допълнителен акцент' },
    ]},
    { title: 'Скролбар', icon: '📜', desc: 'Цветове на лентата за превъртане (вертикална и хоризонтална).', items: [
      { key: 'theme_scrollbar', type: 'color', css: '--scrollbar-thumb', def: '#2a3f4d', label: 'Цвят на скролбара', hint: 'Видимият палец на лентата' },
      { key: 'theme_scrollbar_hover', type: 'color', css: '--scrollbar-thumb-hover', def: '#3a5565', label: 'Скролбар ховър', hint: 'Когато курсорът е върху скролбара' },
    ]},
  ]},

  // ---------- НАВИГАЦИЯ ----------
  { id: 'nav', icon: '🧭', label: 'Навигация', description: 'Горната лента с логото и менютата (Pings, Hey, Home, Boards, и т.н.).', groups: [
    { title: 'Цветове на навигацията', icon: '🎨', desc: 'Фон, текст и активна опция на горната навигационна лента.', items: [
      { key: 'theme_nav_bg', type: 'color', css: null, def: '#1e3040', label: 'Фон на навигацията', hint: 'Целият хоризонтален бар отгоре' },
      { key: 'theme_nav_text', type: 'color', css: null, def: '#8fa3b0', label: 'Текст и икони', hint: 'Цвят на линковете и иконите в нав бара' },
      { key: 'theme_nav_active', type: 'color', css: null, def: '#1cb0f6', label: 'Активно меню', hint: 'Цвят на текущо отворената страница' },
    ]},
    { title: 'Размери на навигацията', icon: '📐', desc: 'Височина на бара, размер на логото и иконите.', items: [
      { key: 'theme_nav_height', type: 'range', css: '--nav-height', def: '50', label: 'Височина на навигацията', unit: 'px', min: 36, max: 70, step: 1, hint: 'Колко висок е горният бар' },
      { key: 'theme_logo_height', type: 'range', css: '--logo-height', def: '22', label: 'Размер на логото', unit: 'px', min: 14, max: 40, step: 1, hint: 'Височина на логото в нав бара' },
      { key: 'theme_nav_icon_size', type: 'range', css: '--nav-icon-size', def: '16', label: 'Размер на иконите', unit: 'px', min: 12, max: 28, step: 1, hint: 'Иконите до текстовите линкове' },
      { key: 'theme_nav_font_size', type: 'range', css: '--nav-font-size', def: '13', label: 'Размер на текста', unit: 'px', min: 10, max: 18, step: 1, hint: 'Текст в линковете на навигацията' },
    ]},
    { title: 'Разстояния и отстъпи', icon: '↔️', desc: 'Разстоянията между елементите в навигацията — padding на линковете, gap между тях, отстъпи от ръбовете.', items: [
      { key: 'theme_nav_padding_x', type: 'range', css: '--nav-padding-x', def: '16', label: 'Странично отстояние на бара', unit: 'px', min: 0, max: 40, step: 1, hint: 'Ляв и десен padding на целия нав бар' },
      { key: 'theme_nav_item_gap', type: 'range', css: '--nav-item-gap', def: '4', label: 'Разстояние между менютата', unit: 'px', min: 0, max: 24, step: 1, hint: 'Gap между Home, Lineup, Pings, Hey, и т.н.' },
      { key: 'theme_nav_link_padding_y', type: 'range', css: '--nav-link-padding-y', def: '6', label: 'Вертикален padding на линк', unit: 'px', min: 0, max: 20, step: 1, hint: 'Отгоре и отдолу на всеки нав линк' },
      { key: 'theme_nav_link_padding_x', type: 'range', css: '--nav-link-padding-x', def: '14', label: 'Хоризонтален padding на линк', unit: 'px', min: 0, max: 32, step: 1, hint: 'Ляво и дясно на всеки нав линк' },
      { key: 'theme_nav_link_gap', type: 'range', css: '--nav-link-gap', def: '5', label: 'Иконa ↔ текст', unit: 'px', min: 0, max: 16, step: 1, hint: 'Разстояние между иконата и текста в линка' },
      { key: 'theme_nav_link_radius', type: 'range', css: '--nav-link-radius', def: '6', label: 'Закръгленост на линк', unit: 'px', min: 0, max: 20, step: 1, hint: 'Border-radius на hover/active фона' },
      { key: 'theme_nav_edge_offset', type: 'range', css: '--nav-edge-offset', def: '16', label: 'Отстъп от ръбовете', unit: 'px', min: 0, max: 40, step: 1, hint: 'Разстояние на логото отляво и аватара отдясно до ръба на екрана' },
      { key: 'theme_nav_me_gap', type: 'range', css: '--nav-me-gap', def: '10', label: 'Разстояние на десния панел', unit: 'px', min: 0, max: 24, step: 1, hint: 'Gap между WS status, SOS и аватара отдясно' },
    ]},
    { title: 'Подменю (Breadcrumb)', icon: '🔗', desc: 'Лентата под навигацията, която показва къде сте (Home > Boards > Project).', items: [
      { key: 'theme_breadcrumb_bg', type: 'color', css: '--breadcrumb-bg', def: '#1e3040', label: 'Фон', hint: 'Лента под нав бара' },
      { key: 'theme_breadcrumb_text', type: 'color', css: '--breadcrumb-text', def: '#8fa3b0', label: 'Линкове', hint: 'Линковете в breadcrumb пътеката' },
      { key: 'theme_breadcrumb_active', type: 'color', css: '--breadcrumb-active', def: '#e8ecee', label: 'Текуща страница', hint: 'Името на текущата страница (последния елемент)' },
      { key: 'theme_breadcrumb_sep', type: 'color', css: '--breadcrumb-sep', def: '#566d7a', label: 'Разделител', hint: 'Символ "/" между елементите' },
    ]},
    { title: 'Dropdown менюта', icon: '📃', desc: 'Падащите менюта (профил, акаунт, навигационни менюта).', items: [
      { key: 'theme_dropdown_bg', type: 'color', css: '--dropdown-bg', def: '#1e3040', label: 'Фон на dropdown', hint: 'Контейнерът на падащото меню' },
      { key: 'theme_dropdown_text', type: 'color', css: '--dropdown-text', def: '#e8ecee', label: 'Текст', hint: 'Текст на опциите' },
      { key: 'theme_dropdown_hover', type: 'color', css: '--dropdown-hover', def: '#243848', label: 'Ховър фон', hint: 'Когато курсорът е върху опция' },
      { key: 'theme_dropdown_dim', type: 'color', css: '--dropdown-dim', def: '#566d7a', label: 'Приглушен текст', hint: 'Метаданни и subitems' },
    ]},
  ]},

  // ---------- НАЧАЛНА СТРАНИЦА ----------
  { id: 'home', icon: '🏠', label: 'Начална страница', description: 'Главната страница с бордовете и docs картите (мрежата от карти).', groups: [
    { title: 'Борд карти', icon: '🃏', desc: 'Картите за всеки борд на началната страница (виждат се при логване).', items: [
      { key: 'theme_card_bg', type: 'color', css: '--home-card-bg', def: '#27353C', label: 'Фон на борд карта', hint: 'Тялото на картата под хедъра' },
      { key: 'theme_card_header', type: 'color', css: '--home-card-header', def: '#3F6B57', label: 'Хедър на борд карта', hint: 'Цветната лента отгоре с името на борда' },
      { key: 'theme_home_card_docs', type: 'color', css: '--home-card-docs', def: '#3a5565', label: 'Хедър на docs карта', hint: 'Документационните бордове' },
    ]},
  ]},

  // ---------- DASHBOARD ----------
  { id: 'dashboard', icon: '📊', label: 'Dashboard', description: 'Главното табло с задачи групирани по борд и колона.', groups: [
    { title: 'Карти на Dashboard', icon: '🃏', desc: 'Малките карти показвани на dashboard-а, групирани по състояние.', items: [
      { key: 'theme_dash_bg', type: 'color', css: '--dash-card-bg', def: '#0b151b', label: 'Фон на карта', hint: 'Малките карти на dashboard' },
      { key: 'theme_dash_title', type: 'color', css: '--dash-card-title', def: '#ffffff', label: 'Заглавие на карта', hint: 'Името на задачата' },
    ]},
    { title: 'Цветове по състояние', icon: '🚦', desc: 'Линията отляво на картата показва спешност спрямо deadline.', items: [
      { key: 'theme_dash_ok', type: 'color', css: '--dash-ok', def: '#22c55e', label: 'Има време (зелено)', hint: 'Карти с дни до дедлайна' },
      { key: 'theme_dash_soon', type: 'color', css: '--dash-soon', def: '#eab308', label: 'Наближава (жълто)', hint: 'Карти с няколко дни до дедлайна' },
      { key: 'theme_dash_today', type: 'color', css: '--dash-today', def: '#ef4444', label: 'Днес (червено)', hint: 'Карти с дедлайн днес' },
      { key: 'theme_dash_overdue', type: 'color', css: '--dash-overdue', def: '#ff0a0a', label: 'Просрочено', hint: 'Закъснели карти (с пулсираща анимация)' },
      { key: 'theme_dash_hold', type: 'color', css: '--dash-hold', def: '#6b7280', label: 'На изчакване', hint: 'Паузирани/spaced карти' },
    ]},
    { title: 'Приоритетни карти', icon: '⭐', desc: 'Карти с приоритет (urgent, high) — показват се в специален стил.', items: [
      { key: 'theme_dash_priority_bg', type: 'color', css: '--dash-priority-bg', def: '#ffffff', label: 'Приоритет: фон', hint: 'Бял фон за приоритетни карти' },
      { key: 'theme_dash_priority_text', type: 'color', css: '--dash-priority-text', def: '#111111', label: 'Приоритет: текст', hint: 'Тъмен текст върху белия фон' },
    ]},
  ]},

  // ---------- KANBAN ----------
  { id: 'kanban', icon: '📋', label: 'Kanban борд', description: 'Бордът с колони и карти (drag & drop таблото).', groups: [
    { title: 'Цветове на борда', icon: '🎨', desc: 'Главните фонове на kanban борда и колоните.', items: [
      { key: 'theme_kanban_bg', type: 'color', css: '--kanban-bg', def: '#0d1a22', label: 'Фон на борда', hint: 'Зад колоните' },
      { key: 'theme_kanban_col', type: 'color', css: '--kanban-col-bg', def: '#1a2e3d', label: 'Фон на колоната', hint: 'Контейнерът на всяка колона' },
    ]},
    { title: 'Kanban карти', icon: '🃏', desc: 'Картите вътре в колоните на kanban борда.', items: [
      { key: 'theme_kcard_bg', type: 'color', css: '--kcard-bg', def: '#1b2930', label: 'Фон на картата', hint: 'Тялото на kanban картата' },
      { key: 'theme_kcard_border', type: 'color', css: '--kcard-border', def: '#1e3040', label: 'Рамка', hint: 'Рамка около kanban картата' },
      { key: 'theme_kcard_title', type: 'color', css: '--kcard-title', def: '#e8ecee', label: 'Заглавие', hint: 'Текстът на името на картата' },
    ]},
    { title: 'Deadline фонове — Kanban', icon: '⏰', desc: 'Цветни фонове на картите спрямо борд-специфичен дедлайн (Снимачен ден, Монтаж, и т.н.).', items: [
      { key: 'theme_dl_green_bg', type: 'color', css: '--dl-green-bg', def: 'rgba(45, 165, 98, 0.38)', label: 'Зелен фон', hint: 'Карти с дни до дедлайна — kanban' },
      { key: 'theme_dl_yellow_bg', type: 'color', css: '--dl-yellow-bg', def: 'rgba(234, 179, 8, 0.42)', label: 'Жълт фон', hint: 'Карти с няколко дни до дедлайна — kanban' },
      { key: 'theme_dl_red_bg', type: 'color', css: '--dl-red-bg', def: 'rgba(239, 68, 68, 0.38)', label: 'Червен фон', hint: 'Карти с дедлайн днес — kanban' },
      { key: 'theme_dl_black_bg', type: 'color', css: '--dl-black-bg', def: 'rgba(0, 0, 0, 0.50)', label: 'Черен фон (просрочено)', hint: 'Закъснели карти — kanban' },
      { key: 'theme_dl_none_bg', type: 'color', css: '--dl-none-bg', def: 'rgba(136, 153, 166, 0.15)', label: 'Без дедлайн', hint: 'Карти без зададен дедлайн' },
    ]},
    { title: 'Deadline badges', icon: '🏷️', desc: 'Малките етикетчета върху картата с надписи за deadline.', items: [
      { key: 'theme_dl_green_badge', type: 'color', css: '--dl-green-badge', def: 'rgba(45, 165, 98, 0.60)', label: 'Зелен badge', hint: 'Добро състояние' },
      { key: 'theme_dl_yellow_badge', type: 'color', css: '--dl-yellow-badge', def: 'rgba(180, 130, 0, 0.70)', label: 'Жълт badge', hint: 'Внимание' },
      { key: 'theme_dl_red_badge', type: 'color', css: '--dl-red-badge', def: 'rgba(239, 68, 68, 0.60)', label: 'Червен badge', hint: 'Критично' },
      { key: 'theme_dl_black_badge', type: 'color', css: '--dl-black-badge', def: 'rgba(0, 0, 0, 0.40)', label: 'Черен badge', hint: 'Просрочено' },
    ]},
    { title: 'Приоритет', icon: '⭐', desc: 'Карти маркирани като приоритетни (с бяла лява лента).', items: [
      { key: 'theme_priority_bg', type: 'color', css: '--priority-card-bg', def: 'rgba(255, 255, 255, 0.06)', label: 'Фон на приоритетна карта', hint: 'Полупрозрачен бял gradient фон' },
      { key: 'theme_priority_border', type: 'color', css: '--priority-card-border', def: '#ffffff', label: 'Лява лента', hint: 'Цвят на бялата лента отляво' },
    ]},
  ]},

  // ---------- ПРОИЗВОДСТВЕН КАЛЕНДАР ----------
  { id: 'calendar', icon: '📅', label: 'Производствен календар', description: 'Седмичният календар със scheduled задачи (drag & drop в часови блокове).', groups: [
    { title: 'Цветове на календара', icon: '🎨', desc: 'Главните фонове и линии на седмичния изглед.', items: [
      { key: 'theme_pc_bg', type: 'color', css: '--pc-bg', def: '#0b151b', label: 'Фон на календара', hint: 'Цялата календарна област' },
      { key: 'theme_pc_sidebar_bg', type: 'color', css: '--pc-sidebar-bg', def: '#1b2930', label: 'Странична лента', hint: 'Колоната с unscheduled карти отляво' },
      { key: 'theme_pc_today_bg', type: 'color', css: '--pc-today-bg', def: 'rgba(70, 163, 116, 0.08)', label: 'Фон на днешния ден', hint: 'Колоната за днешния ден е леко оцветена' },
    ]},
    { title: 'Линии на грид-а', icon: '📏', desc: 'Линиите между часовете в седмичния изглед.', items: [
      { key: 'theme_pc_grid_line', type: 'color', css: '--pc-grid-line', def: 'rgba(255, 255, 255, 0.07)', label: 'Главни линии', hint: 'Линии на всеки час' },
      { key: 'theme_pc_grid_half', type: 'color', css: '--pc-grid-half', def: 'rgba(255, 255, 255, 0.04)', label: 'Половин линии', hint: 'Линии на половин час (по-приглушени)' },
    ]},
    { title: 'Събития в календара', icon: '🎫', desc: 'Цветни блокове за scheduled карти.', items: [
      { key: 'theme_pc_event_done_bg', type: 'color', css: '--pc-event-done-bg', def: 'rgba(255, 255, 255, 0.18)', label: 'Завършено събитие', hint: 'Рамка на завършените събития' },
      { key: 'theme_pc_event_check', type: 'color', css: '--pc-event-check', def: 'rgba(255, 255, 255, 0.25)', label: 'Чекмарк бутон', hint: 'Кръгчето за маркиране като завършено' },
    ]},
    { title: 'Deadline фонове — Календар', icon: '⏰', desc: 'Цветовете на mini-картите в страничната лента (по дедлайн).', items: [
      { key: 'theme_dl_green_bg_pc', type: 'color', css: '--dl-green-bg-pc', def: 'rgba(45, 165, 98, 0.32)', label: 'Зелен фон (PC)', hint: 'Mini-карти зелено състояние' },
      { key: 'theme_dl_yellow_bg_pc', type: 'color', css: '--dl-yellow-bg-pc', def: 'rgba(234, 179, 8, 0.35)', label: 'Жълт фон (PC)', hint: 'Mini-карти жълто състояние' },
      { key: 'theme_dl_red_bg_pc', type: 'color', css: '--dl-red-bg-pc', def: 'rgba(239, 68, 68, 0.32)', label: 'Червен фон (PC)', hint: 'Mini-карти червено състояние' },
      { key: 'theme_dl_black_bg_pc', type: 'color', css: '--dl-black-bg-pc', def: 'rgba(0, 0, 0, 0.45)', label: 'Черен фон (PC)', hint: 'Mini-карти просрочени' },
    ]},
  ]},

  // ---------- ЧАТ И CAMPFIRE ----------
  { id: 'chat', icon: '💬', label: 'Чат и Campfire', description: 'Чат балончетата в Campfire (комуникация на екипа) и в карти.', groups: [
    { title: 'Цветове на съобщения', icon: '🎨', desc: 'Фоновете на балончетата за чужди и собствени съобщения.', items: [
      { key: 'theme_chat_msg_other', type: 'color', css: '--chat-msg-other-bg', def: '#27353C', label: 'Балонче — другите', hint: 'Съобщения от други хора (отляво)' },
      { key: 'theme_chat_msg_own', type: 'color', css: '--chat-msg-own-bg', def: '#293F54', label: 'Балонче — мое', hint: 'Собствените съобщения (отдясно)' },
    ]},
    { title: 'Текст в чата', icon: '✏️', desc: 'Цветове на имената и текста на съобщенията.', items: [
      { key: 'theme_chat_msg_name_other', type: 'color', css: '--chat-msg-name-other', def: '#8fa3b0', label: 'Име — другите', hint: 'Името на изпращача (отляво)' },
      { key: 'theme_chat_msg_name_own', type: 'color', css: '--chat-msg-name-own', def: '#ffffff', label: 'Име — мое', hint: 'Собственото име (отдясно)' },
    ]},
  ]},

  // ---------- HEY ИЗВЕСТИЯ ----------
  { id: 'hey', icon: '🔔', label: 'Hey известия', description: 'Страницата с непрочетени mentions, ping-ове и bookmarks.', groups: [
    { title: 'Известия', icon: '🔔', desc: 'Цветове на различните секции в Hey страницата.', items: [
      { key: 'theme_hey_unread', type: 'color', css: null, def: '#46a374', label: 'Фон на непрочетено', hint: 'Списъкът с непрочетени известия (леко оцветен)' },
      { key: 'theme_hey_bookmarks', type: 'color', css: null, def: '#46a374', label: 'Секция отметки', hint: 'Bookmarks секцията (леко оцветена)' },
      { key: 'theme_hey_dot', type: 'color', css: '--hey-dot', def: '#1cb0f6', label: 'Точка непрочетено', hint: 'Малката цветна точка до известието' },
    ]},
  ]},

  // ---------- БУТОНИ ----------
  { id: 'buttons', icon: '🔘', label: 'Бутони и форми', description: 'Бутони, инпути, селект полета и форми.', groups: [
    { title: 'Главен бутон', icon: '✅', desc: 'Зеленият Action бутон — Запази, Създай, Прати.', items: [
      { key: 'theme_btn_primary', type: 'color', css: '--btn-primary-bg', def: '#46a374', label: 'Фон на главен бутон', hint: 'Зелените CTA бутони' },
      { key: 'theme_btn_primary_hover', type: 'color', css: '--btn-primary-hover', def: '#3d9168', label: 'Главен бутон — ховър', hint: 'Когато курсорът е върху бутона' },
      { key: 'theme_btn_text', type: 'color', css: '--btn-text', def: '#ffffff', label: 'Текст на бутона', hint: 'Цвят на надписа' },
    ]},
    { title: 'Полета (input/textarea)', icon: '⌨️', desc: 'Текстовите полета за въвеждане.', items: [
      { key: 'theme_input_bg', type: 'color', css: '--input-bg', def: '#0b151b', label: 'Фон на полето', hint: 'Вътрешният фон на input' },
      { key: 'theme_input_border', type: 'color', css: '--input-border', def: '#1e3040', label: 'Рамка на полето', hint: 'Рамката около input' },
      { key: 'theme_input_text', type: 'color', css: '--input-text', def: '#e8ecee', label: 'Текст в полето', hint: 'Цвят на въведения текст' },
      { key: 'theme_input_focus_border', type: 'color', css: '--input-focus-border', def: '#1cb0f6', label: 'Рамка при фокус', hint: 'Когато потребителят кликне в полето' },
      { key: 'theme_input_placeholder', type: 'color', css: '--input-placeholder', def: '#566d7a', label: 'Placeholder текст', hint: 'Помощният текст преди писане' },
    ]},
  ]},

];
