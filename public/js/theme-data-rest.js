// ==================== THEME DATA — rest of THEME_TABS + THEME_CONFIG ====================
THEME_TABS.push(
  // ---------- МОДАЛИ И TOAST ----------
  { id: 'modals', icon: '🪟', label: 'Модали и Toast', description: 'Изскачащи прозорци (модали), потвърждения и Toast съобщения.', groups: [
    { title: 'Модали', icon: '🪟', desc: 'Изскачащите прозорци за потвърждение, въвеждане, и т.н.', items: [
      { key: 'theme_modal_overlay', type: 'color', css: '--modal-overlay', def: 'rgba(0, 0, 0, 0.6)', label: 'Затъмнение зад модала', hint: 'Полупрозрачният фон зад модала' },
      { key: 'theme_modal_bg', type: 'color', css: '--modal-bg', def: '#1b2930', label: 'Фон на модала', hint: 'Самият контейнер на модала' },
    ]},
    { title: 'Toast съобщения', icon: '📢', desc: 'Малките известия в горния десен ъгъл.', items: [
      { key: 'theme_toast_bg', type: 'color', css: '--toast-bg', def: '#1e3040', label: 'Фон на Toast', hint: 'Фонът на toast съобщенията' },
      { key: 'theme_toast_success', type: 'color', css: '--toast-success', def: '#22c55e', label: 'Лента — успех', hint: 'Зелена лева лента' },
      { key: 'theme_toast_error', type: 'color', css: '--toast-error', def: '#ef4444', label: 'Лента — грешка', hint: 'Червена лева лента' },
      { key: 'theme_toast_info', type: 'color', css: '--toast-info', def: '#1cb0f6', label: 'Лента — инфо', hint: 'Синя лева лента' },
      { key: 'theme_toast_warning', type: 'color', css: '--toast-warning', def: '#eab308', label: 'Лента — внимание', hint: 'Жълта лева лента' },
    ]},
  ]},

  // ---------- ТИПОГРАФИЯ ----------
  { id: 'typography', icon: '🔤', label: 'Типография', description: 'Шрифт, размер на текста, височина на ред, дебелина на заглавия.', groups: [
    { title: 'Шрифт', icon: '🔤', desc: 'Семейство и базов размер на шрифта в платформата.', items: [
      { key: 'theme_font_family', type: 'select', css: '--font-family', def: 'Inter', label: 'Шрифт', options: ['Inter','Roboto','Open Sans','Nunito','Poppins','Lato','Montserrat','Source Sans Pro','Fira Sans','IBM Plex Sans'], hint: 'Google Fonts шрифт' },
      { key: 'theme_font_size', type: 'range', css: '--font-size-base', def: '13.5', label: 'Основен размер', unit: 'px', min: 11, max: 18, step: 0.5, hint: 'Базов размер на текста' },
      { key: 'theme_line_height', type: 'range', css: '--line-height-base', def: '1.6', label: 'Височина на ред', unit: '', min: 1.2, max: 2.2, step: 0.1, hint: 'Колко на ред да заема текста' },
      { key: 'theme_heading_weight', type: 'select', css: '--heading-weight', def: '700', label: 'Дебелина на заглавия', options: ['400','500','600','700','800','900'], hint: 'От тънки (400) до удебелени (900)' },
    ]},
  ]},

  // ---------- РАЗМЕРИ ----------
  { id: 'sizing', icon: '📐', label: 'Размери и закръгленост', description: 'Закръгленост на ъглите, отстояния, шадоу.', groups: [
    { title: 'Закръгленост', icon: '⚪', desc: 'Радиусите на ъглите за карти, бутони и контейнери.', items: [
      { key: 'theme_radius', type: 'range', css: '--radius', def: '8', label: 'Малка закръгленост', unit: 'px', min: 0, max: 20, step: 1, hint: 'За бутони и малки елементи' },
      { key: 'theme_radius_lg', type: 'range', css: '--radius-lg', def: '12', label: 'Голяма закръгленост', unit: 'px', min: 0, max: 24, step: 1, hint: 'За карти и панели' },
      { key: 'theme_btn_radius', type: 'range', css: '--btn-radius', def: '8', label: 'Закръгленост на бутон', unit: 'px', min: 0, max: 30, step: 1, hint: 'Само за бутоните' },
      { key: 'theme_input_radius', type: 'range', css: '--input-radius', def: '8', label: 'Закръгленост на полета', unit: 'px', min: 0, max: 20, step: 1, hint: 'Само за input/textarea' },
      { key: 'theme_modal_radius', type: 'range', css: '--modal-radius', def: '12', label: 'Закръгленост на модал', unit: 'px', min: 0, max: 24, step: 1, hint: 'Само за изскачащи прозорци' },
      { key: 'theme_home_card_radius', type: 'range', css: '--home-card-radius', def: '14', label: 'Закръгленост на home карта', unit: 'px', min: 0, max: 24, step: 1, hint: 'Картите на началната страница' },
      { key: 'theme_kcard_radius', type: 'range', css: '--kcard-radius', def: '8', label: 'Закръгленост на kanban карта', unit: 'px', min: 0, max: 20, step: 1, hint: 'Картите в kanban борда' },
    ]},
  ]},

  // ---------- ПРОЗРАЧНОСТИ И СЕНКИ ----------
  { id: 'overlays', icon: '🌫️', label: 'Прозрачности и Сенки', description: 'Полупрозрачни наслагвания, разделители и сенки — главните причини за "опасити" ефекти. Увеличи тези стойности за по-ясна видимост.', groups: [
    { title: 'Бели overlay наслагвания', icon: '⬜', desc: 'Светли полупрозрачни слоеве върху тъмния фон — за hover ефекти, code блокове, divider-и. Ако нещо изглежда избеляло — увеличи тук.', items: [
      { key: 'theme_overlay_white_ultra', type: 'color', css: '--overlay-white-ultra', def: 'rgba(255, 255, 255, 0.06)', label: 'Ултра слаб бял слой', hint: 'Chat attachment, trix toolbar, hover фонове (най-слабо видими)' },
      { key: 'theme_overlay_white_faint', type: 'color', css: '--overlay-white-faint', def: 'rgba(255, 255, 255, 0.10)', label: 'Слаб бял слой', hint: 'Trix active бутон, leading-edge ефекти' },
      { key: 'theme_overlay_white_light', type: 'color', css: '--overlay-white-light', def: 'rgba(255, 255, 255, 0.14)', label: 'Нормален бял слой', hint: 'Lightbox close бутон, leave-edge' },
      { key: 'theme_overlay_white_medium', type: 'color', css: '--overlay-white-medium', def: 'rgba(255, 255, 255, 0.20)', label: 'Среден бял слой', hint: 'SOS resolve бутон, focus indicators' },
      { key: 'theme_overlay_white_strong', type: 'color', css: '--overlay-white-strong', def: 'rgba(255, 255, 255, 0.28)', label: 'Силен бял слой', hint: 'Color swatch hover border, accent overlays' },
    ]},
    { title: 'Тъмни overlay наслагвания', icon: '⬛', desc: 'Тъмни полупрозрачни слоеве — за модали, drop shadows, и тъмни детайли.', items: [
      { key: 'theme_overlay_black_ultra', type: 'color', css: '--overlay-black-ultra', def: 'rgba(0, 0, 0, 0.12)', label: 'Ултра слабо затъмняване', hint: 'Resize handle, много леки overlay-и' },
      { key: 'theme_overlay_black_faint', type: 'color', css: '--overlay-black-faint', def: 'rgba(0, 0, 0, 0.20)', label: 'Слабо затъмняване', hint: 'Vault thumb фон, editor background' },
      { key: 'theme_overlay_black_light', type: 'color', css: '--overlay-black-light', def: 'rgba(0, 0, 0, 0.30)', label: 'Нормално затъмняване', hint: 'Card shadow base' },
      { key: 'theme_overlay_black_medium', type: 'color', css: '--overlay-black-medium', def: 'rgba(0, 0, 0, 0.45)', label: 'Средно затъмняване', hint: 'Delete бутони, силни overlays' },
      { key: 'theme_overlay_black_strong', type: 'color', css: '--overlay-black-strong', def: 'rgba(0, 0, 0, 0.65)', label: 'Силно затъмняване', hint: 'Video preview header, модални фонове' },
    ]},
    { title: 'Сенки (box-shadow)', icon: '🌑', desc: 'Цвят и интензивност на сенките под карти, бутони, и модали. По-тъмна сянка = по-изразен 3D ефект.', items: [
      { key: 'theme_shadow_color_sm', type: 'color', css: '--shadow-color-sm', def: 'rgba(0, 0, 0, 0.35)', label: 'Малка сянка (shadow-sm)', hint: 'Използва се от елементи с малка сянка — toolbar бутони, малки overlays' },
      { key: 'theme_shadow_color_md', type: 'color', css: '--shadow-color-md', def: 'rgba(0, 0, 0, 0.45)', label: 'Средна сянка (shadow-md)', hint: 'Карти, модали, dropdown менюта' },
      { key: 'theme_shadow_color_lg', type: 'color', css: '--shadow-color-lg', def: 'rgba(0, 0, 0, 0.55)', label: 'Голяма сянка (shadow-lg)', hint: 'Големи popups, lightbox, goldfinger елементи' },
      { key: 'theme_card_hover_shadow', type: 'color', css: '--card-hover-shadow', def: 'rgba(0, 0, 0, 0.35)', label: 'Hover сянка на карти', hint: 'Когато курсорът е върху kanban/dash карта' },
      { key: 'theme_avatar_shadow', type: 'color', css: '--avatar-shadow', def: 'rgba(0, 0, 0, 0.20)', label: 'Сянка на аватар', hint: 'Малка сянка под кръглите аватари' },
    ]},
    { title: 'Разделители (divider-и)', icon: '➖', desc: 'Тънките хоризонтални линии между редове на карти, history items, production dates.', items: [
      { key: 'theme_divider_faint', type: 'color', css: '--divider-faint', def: 'rgba(255, 255, 255, 0.08)', label: 'Слаб divider', hint: 'Между production date редове, history items' },
      { key: 'theme_divider_light', type: 'color', css: '--divider-light', def: 'rgba(255, 255, 255, 0.12)', label: 'Нормален divider', hint: 'Border-top-и на publish секции, toolbar-и' },
      { key: 'theme_divider_medium', type: 'color', css: '--divider-medium', def: 'rgba(255, 255, 255, 0.18)', label: 'Силен divider', hint: 'Editor borders, видими рамки' },
    ]},
  ]},

  // ---------- КОМПОНЕНТИ ----------
  { id: 'components', icon: '🎭', label: 'Компоненти и Детайли', description: 'Фини UI детайли — code блокове, drag & drop, focus ring, код текст.', groups: [
    { title: 'Code блокове', icon: '💻', desc: 'Inline code и code блокове в chat и document editor.', items: [
      { key: 'theme_code_bg', type: 'color', css: '--code-bg', def: 'rgba(255, 255, 255, 0.12)', label: 'Фон на code', hint: 'Фонът на <code> тагове в чата и документите' },
      { key: 'theme_code_text', type: 'color', css: '--code-text', def: '#e8ecee', label: 'Текст в code', hint: 'Цветът на text-а в <code> елементи' },
    ]},
    { title: 'Drag & Drop', icon: '🖐️', desc: 'Визуални индикатори при влачене на карти в колони и dashboard.', items: [
      { key: 'theme_drag_over_bg', type: 'color', css: '--drag-over-bg', def: 'rgba(28, 176, 246, 0.15)', label: 'Фон при drag over', hint: 'Полупрозрачен фон на drop зоната (когато влачиш карта над нея)' },
      { key: 'theme_drag_over_border', type: 'color', css: '--drag-over-border', def: '#1cb0f6', label: 'Рамка при drag over', hint: 'Dashed рамка на активна drop зона' },
    ]},
    { title: 'Фокус рингове', icon: '🎯', desc: 'Индикатори при клавиатурна навигация (Tab ключ).', items: [
      { key: 'theme_focus_ring_color', type: 'color', css: '--focus-ring-color', def: '#1cb0f6', label: 'Цвят на focus ring', hint: 'Цветът на полето при фокус с клавиатурата' },
    ]},
    { title: 'Kanban допълнителни', icon: '📋', desc: 'Цветни малки елементи на kanban борда — preview bars, WIP limit, section pills.', items: [
      { key: 'theme_kanban_preview_orange', type: 'color', css: '--kanban-preview-orange', def: 'rgba(249, 115, 22, 0.28)', label: 'Preview лента — оранжево', hint: 'Първата колона в boards grid preview' },
      { key: 'theme_kanban_preview_blue', type: 'color', css: '--kanban-preview-blue', def: 'rgba(59, 130, 246, 0.28)', label: 'Preview лента — синьо', hint: 'Втора колона в boards grid preview' },
      { key: 'theme_kanban_preview_teal', type: 'color', css: '--kanban-preview-teal', def: 'rgba(20, 184, 166, 0.28)', label: 'Preview лента — тийл', hint: 'Пета колона в boards grid preview' },
      { key: 'theme_kanban_wip_bg', type: 'color', css: '--kanban-wip-bg', def: 'rgba(239, 68, 68, 0.22)', label: 'WIP limit — фон', hint: 'Показва се когато колоната има твърде много карти' },
      { key: 'theme_kanban_wip_border', type: 'color', css: '--kanban-wip-border', def: 'rgba(239, 68, 68, 0.45)', label: 'WIP limit — рамка', hint: 'Червена рамка на overloaded колона' },
      { key: 'theme_kanban_on_hold_bg', type: 'color', css: '--kanban-on-hold-bg', def: 'rgba(255, 255, 255, 0.14)', label: 'On-hold секция — фон', hint: 'Pill с брой на пауза' },
      { key: 'theme_kanban_on_hold_border', type: 'color', css: '--kanban-on-hold-border', def: 'rgba(255, 255, 255, 0.12)', label: 'On-hold секция — рамка', hint: 'Dashed рамка на drop zone' },
      { key: 'theme_kanban_col_border', type: 'color', css: '--kanban-col-border', def: 'rgba(255, 255, 255, 0.07)', label: 'Рамка на kanban колона', hint: 'Тънката рамка около всяка колона' },
      { key: 'theme_kanban_section_pill', type: 'color', css: '--kanban-section-pill-bg', def: 'rgba(249, 115, 22, 0.20)', label: 'Секция pill — оранжева', hint: 'Пиловете за секции с оранжев цвят' },
    ]},
    { title: 'Production Calendar — детайли', icon: '📅', desc: 'Фини елементи в седмичния и месечния изглед на календара.', items: [
      { key: 'theme_pc_empty_day', type: 'color', css: '--pc-empty-day-bg', def: 'rgba(0, 0, 0, 0.18)', label: 'Фон на празен ден', hint: 'Дните преди/след месеца в месечен изглед' },
      { key: 'theme_pc_weekend', type: 'color', css: '--pc-weekend-bg', def: 'rgba(0, 0, 0, 0.14)', label: 'Фон на уикенд', hint: 'Събота и неделя в месечен изглед' },
      { key: 'theme_pc_dot_due_bg', type: 'color', css: '--pc-dot-due-bg', def: 'rgba(59, 130, 246, 0.28)', label: 'Dot — Deadline фон', hint: 'Син pill за deadline дни в месечен изглед' },
      { key: 'theme_pc_dot_due_text', type: 'color', css: '--pc-dot-due-text', def: '#60a5fa', label: 'Dot — Deadline текст', hint: 'Цвят на текста в deadline pill' },
      { key: 'theme_pc_dot_publish_bg', type: 'color', css: '--pc-dot-publish-bg', def: 'rgba(70, 163, 116, 0.28)', label: 'Dot — Публикация фон', hint: 'Зелен pill за публикации' },
      { key: 'theme_pc_dot_publish_text', type: 'color', css: '--pc-dot-publish-text', def: '#46a374', label: 'Dot — Публикация текст', hint: 'Цвят на текста в публикации pill' },
      { key: 'theme_pc_dot_step_bg', type: 'color', css: '--pc-dot-step-bg', def: 'rgba(234, 179, 8, 0.28)', label: 'Dot — Стъпка фон', hint: 'Жълт pill за stepwise събития' },
      { key: 'theme_pc_dot_step_text', type: 'color', css: '--pc-dot-step-text', def: '#eab308', label: 'Dot — Стъпка текст', hint: 'Цвят на текста в step pill' },
    ]},
    { title: 'Chat — Campfire System', icon: '🤖', desc: 'Автоматичните system messages в чата (например "User joined").', items: [
      { key: 'theme_chat_unread_bg', type: 'color', css: '--chat-unread-bg', def: 'rgba(70, 163, 116, 0.12)', label: 'Фон на непрочетен чат', hint: 'Leva лента на непрочетени съобщения в Pings dropdown' },
      { key: 'theme_chat_system_from', type: 'color', css: '--chat-system-msg-from', def: '#2a4a5a', label: 'System msg gradient начало', hint: 'Начален цвят на gradient-а за system съобщения' },
      { key: 'theme_chat_system_to', type: 'color', css: '--chat-system-msg-to', def: '#1a3040', label: 'System msg gradient край', hint: 'Краен цвят на gradient-а за system съобщения' },
    ]},
    { title: 'Dashboard — On Hold', icon: '⏸️', desc: 'Карти на пауза в dashboard (спрени или отложени).', items: [
      { key: 'theme_dash_hold_border', type: 'color', css: '--dash-hold-border', def: '#4b5563', label: 'On-hold separator', hint: 'Dashed border на on-hold separator линията' },
    ]},
  ]},

  // ---------- АЛАРМИ И СЪСТОЯНИЯ ----------
  { id: 'alerts', icon: '🚨', label: 'Аларми и Състояния', description: 'Аварийни сигнали, warnings, банери за редактиране и trash състояния.', groups: [
    { title: 'SOS / Аварийни сигнали', icon: '🆘', desc: 'Червеният банер най-горе при изпратен SOS от друг user.', items: [
      { key: 'theme_sos_from', type: 'color', css: '--sos-alert-bg-from', def: '#7f1d1d', label: 'SOS gradient — начало', hint: 'Началният цвят на gradient-а за SOS alert банера (тъмно червено)' },
      { key: 'theme_sos_to', type: 'color', css: '--sos-alert-bg-to', def: '#991b1b', label: 'SOS gradient — край', hint: 'Крайният цвят на gradient-а за SOS banner' },
      { key: 'theme_sos_border', type: 'color', css: '--sos-alert-border', def: '#ef4444', label: 'SOS долна лента', hint: 'Border-bottom на SOS banner (ярко червено)' },
      { key: 'theme_sos_text', type: 'color', css: '--sos-alert-text', def: '#ffffff', label: 'SOS текст', hint: 'Цвят на текста в SOS alert banner' },
      { key: 'theme_sos_modal_bg', type: 'color', css: '--sos-modal-bg', def: '#1b2930', label: 'Фон на SOS модал', hint: 'Модала за изпращане на нов SOS сигнал' },
    ]},
    { title: 'КП Автоматизация — Warnings', icon: '⚠️', desc: 'Warning банери в КП автоматизация (missing data, validation грешки).', items: [
      { key: 'theme_kp_warning_bg', type: 'color', css: '--kp-warning-bg', def: 'rgba(220, 120, 0, 0.18)', label: 'Warning — фон', hint: 'Оранжев полупрозрачен фон на warning банер' },
      { key: 'theme_kp_warning_border', type: 'color', css: '--kp-warning-border', def: 'rgba(220, 120, 0, 0.45)', label: 'Warning — рамка', hint: 'Оранжева рамка около warning банер' },
      { key: 'theme_kp_warning_text', type: 'color', css: '--kp-warning-text', def: '#f59e0b', label: 'Warning — текст', hint: 'Цвят на текста в warning банер' },
    ]},
    { title: 'Editing Banner', icon: '✏️', desc: 'Жълтият банер при кратка карта "Тази карта се редактира в момента от ...".', items: [
      { key: 'theme_editing_bg', type: 'color', css: '--editing-banner-bg', def: 'rgba(234, 179, 8, 0.18)', label: 'Фон на банера', hint: 'Жълт полупрозрачен фон' },
      { key: 'theme_editing_border', type: 'color', css: '--editing-banner-border', def: 'rgba(234, 179, 8, 0.45)', label: 'Рамка на банера', hint: 'Жълта рамка около банера' },
      { key: 'theme_editing_text', type: 'color', css: '--editing-banner-text', def: '#eab308', label: 'Текст на банера', hint: 'Цвят на текста' },
    ]},
    { title: 'Trash / Кошче — състояния', icon: '🗑️', desc: 'Карти в trash view с warning (наближаващо изтриване) и urgent (много скоро).', items: [
      { key: 'theme_trash_urgent_bg', type: 'color', css: '--trash-urgent-bg', def: 'rgba(239, 68, 68, 0.12)', label: 'Urgent — фон', hint: 'Червен фон за карти на път да бъдат изтрити' },
      { key: 'theme_trash_urgent_border', type: 'color', css: '--trash-urgent-border', def: 'rgba(239, 68, 68, 0.55)', label: 'Urgent — рамка', hint: 'Яркочервена рамка около urgent карти' },
      { key: 'theme_trash_warning_border', type: 'color', css: '--trash-warning-border', def: 'rgba(234, 179, 8, 0.50)', label: 'Warning — рамка', hint: 'Жълта рамка за карти в по-ранна фаза' },
      { key: 'theme_trash_banner_bg', type: 'color', css: '--trash-banner-bg', def: 'rgba(239, 68, 68, 0.18)', label: 'Trash banner фон', hint: 'Банерът на card detail страница когато картата е в trash' },
      { key: 'theme_trash_banner_border', type: 'color', css: '--trash-banner-border', def: 'rgba(239, 68, 68, 0.45)', label: 'Trash banner рамка', hint: 'Рамка около trash banner' },
    ]},
  ]},
);


// ---------- BACKWARDS COMPATIBILITY ----------
// Запазваме THEME_CONFIG като flatten на THEME_TABS (за функции които използват директно)
var THEME_CONFIG = (function() {
  var result = [];
  THEME_TABS.forEach(function(tab) {
    tab.groups.forEach(function(group) {
      result.push({ title: group.title, icon: group.icon, items: group.items });
    });
  });
  return result;
})();

