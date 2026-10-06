// 푸시 알림 다국어(2026-10-02): 앱이 언어별 토픽(player_<hash>_<lang>)을 구독하고, 서버는 언어별 문구로 각각 발송.
// 앱 언어 목록/순서는 App.tsx와 동일. 이름·팀·리그는 가능한 한 해당 언어로, 없으면 영문 폴백.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rd = (f) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')); } catch { return {}; } };
const LEAGUE = rd('league-i18n.json');
const TEAM_EN = rd('team-name-en.json');
const PLAYER_EN = rd('player-name-en.json');
const PLAYER_I18N = rd('player-name-i18n.json');

export const LANGS = ['ko', 'en', 'ja', 'es', 'pt', 'fr', 'de', 'it', 'ru', 'ar', 'id', 'th', 'vi', 'zh-Hans', 'zh-Hant', 'hi', 'tr', 'nl'];

// 순서: goal, assist, yellow, red, sp(선발 등판), hr, 2b, 3b, err, sb, cs, dp, wp, gw, po, ro, pb, bk
const KEYS = ['goal', 'assist', 'yellow', 'red', 'sp', 'hr', 'd2', 'd3', 'err', 'sb', 'cs', 'dp', 'wp', 'gw', 'po', 'ro', 'pb', 'bk', 'rp'];
const HOW = { 홈런: 'hr', '2루타': 'd2', '3루타': 'd3', 실책: 'err', 도루: 'sb', 도루자: 'cs', 병살타: 'dp', 폭투: 'wp', 결승타: 'gw', 견제사: 'po', 주루사: 'ro', 포일: 'pb', 보크: 'bk' };
const L = {
  ko: ['골', '어시스트', '경고', '퇴장', '선발 등판', '홈런', '2루타', '3루타', '실책', '도루', '도루 실패', '병살타', '폭투', '결승타', '견제사', '주루사', '포일', '보크', '구원 등판'],
  en: ['Goal', 'Assist', 'Yellow card', 'Red card', 'Starting pitcher', 'Home run', 'Double', 'Triple', 'Error', 'Stolen base', 'Caught stealing', 'Double play', 'Wild pitch', 'Game-winning RBI', 'Picked off', 'Out on bases', 'Passed ball', 'Balk', 'Relief pitcher'],
  ja: ['ゴール', 'アシスト', 'イエローカード', 'レッドカード', '先発登板', 'ホームラン', '二塁打', '三塁打', 'エラー', '盗塁', '盗塁失敗', '併殺打', '暴投', '決勝打', '牽制死', '走塁死', 'パスボール', 'ボーク', '救援登板'],
  es: ['Gol', 'Asistencia', 'Tarjeta amarilla', 'Tarjeta roja', 'Lanzador abridor', 'Jonrón', 'Doble', 'Triple', 'Error', 'Base robada', 'Out al robar', 'Doble play', 'Wild pitch', 'Carrera decisiva', 'Out por pickoff', 'Out en las bases', 'Passed ball', 'Balk', 'Relevista'],
  pt: ['Gol', 'Assistência', 'Cartão amarelo', 'Cartão vermelho', 'Arremessador titular', 'Home run', 'Dupla', 'Tripla', 'Erro', 'Base roubada', 'Eliminado ao roubar', 'Duplo play', 'Wild pitch', 'Rebatida decisiva', 'Eliminado em pickoff', 'Eliminado nas bases', 'Passed ball', 'Balk', 'Relevo'],
  fr: ['But', 'Passe décisive', 'Carton jaune', 'Carton rouge', 'Lanceur partant', 'Coup de circuit', 'Double', 'Triple', 'Erreur', 'Base volée', 'Surpris en vol', 'Double jeu', 'Mauvais lancer', 'Point décisif', 'Retiré sur prise', 'Retiré sur les bases', 'Balle passée', 'Balk', 'Releveur'],
  de: ['Tor', 'Vorlage', 'Gelbe Karte', 'Rote Karte', 'Startpitcher', 'Homerun', 'Double', 'Triple', 'Fehler', 'Base gestohlen', 'Beim Stehlen gefangen', 'Double Play', 'Wild Pitch', 'Siegpunkt', 'Abgeworfen', 'Auf den Bases aus', 'Passed Ball', 'Balk', 'Reliever'],
  it: ['Gol', 'Assist', 'Cartellino giallo', 'Cartellino rosso', 'Lanciatore partente', 'Fuoricampo', 'Doppio', 'Triplo', 'Errore', 'Base rubata', 'Eliminato in rubata', 'Doppio gioco', 'Lancio pazzo', 'Punto decisivo', 'Eliminato in pickoff', 'Eliminato sulle basi', 'Passed ball', 'Balk', 'Rilievo'],
  ru: ['Гол', 'Передача', 'Жёлтая карточка', 'Красная карточка', 'Стартовый питчер', 'Хоумран', 'Дабл', 'Трипл', 'Ошибка', 'Украденная база', 'Поймали при краже', 'Дабл-плей', 'Вайлд-питч', 'Победное очко', 'Выбит пикоффом', 'Выбит на базах', 'Пасс-болл', 'Балк', 'Реливер'],
  ar: ['هدف', 'تمريرة حاسمة', 'بطاقة صفراء', 'بطاقة حمراء', 'رامي البداية', 'هوم ران', 'دابل', 'تريبل', 'خطأ', 'سرقة قاعدة', 'فشل السرقة', 'لعبة مزدوجة', 'رمية طائشة', 'نقطة الفوز', 'إخراج بالرمي', 'إخراج على القواعد', 'كرة ممررة', 'بولك', 'رامي الإغاثة'],
  id: ['Gol', 'Assist', 'Kartu kuning', 'Kartu merah', 'Pelempar awal', 'Home run', 'Double', 'Triple', 'Error', 'Mencuri base', 'Gagal mencuri base', 'Double play', 'Wild pitch', 'RBI penentu', 'Pickoff out', 'Out di base', 'Passed ball', 'Balk', 'Pelempar relief'],
  th: ['ประตู', 'แอสซิสต์', 'ใบเหลือง', 'ใบแดง', 'พิชเชอร์ตัวจริง', 'โฮมรัน', 'ดับเบิล', 'ทริปเปิล', 'เออร์เรอร์', 'ขโมยเบส', 'ขโมยเบสพลาด', 'ดับเบิลเพลย์', 'ไวลด์พิตช์', 'แต้มชี้ขาด', 'โดนจับพิคออฟ', 'ออกบนเบส', 'พาสบอล', 'บอล์ก', 'พิชเชอร์ตัวสำรอง'],
  vi: ['Bàn thắng', 'Kiến tạo', 'Thẻ vàng', 'Thẻ đỏ', 'Cầu thủ ném chính', 'Home run', 'Double', 'Triple', 'Lỗi', 'Cướp base', 'Cướp base thất bại', 'Double play', 'Wild pitch', 'RBI quyết định', 'Bị loại do pickoff', 'Bị loại trên base', 'Passed ball', 'Balk', 'Cầu thủ ném thay'],
  'zh-Hans': ['进球', '助攻', '黄牌', '红牌', '先发投手', '全垒打', '二垒打', '三垒打', '失误', '盗垒', '盗垒失败', '双杀', '暴投', '决胜打点', '牵制出局', '跑垒出局', '捕逸', '投手违规', '救援登板'],
  'zh-Hant': ['進球', '助攻', '黃牌', '紅牌', '先發投手', '全壘打', '二壘打', '三壘打', '失誤', '盜壘', '盜壘失敗', '雙殺', '暴投', '決勝打點', '牽制出局', '跑壘出局', '捕逸', '投手違規', '救援登板'],
  hi: ['गोल', 'असिस्ट', 'येलो कार्ड', 'रेड कार्ड', 'स्टार्टिंग पिचर', 'होम रन', 'डबल', 'ट्रिपल', 'एरर', 'बेस चोरी', 'बेस चोरी विफल', 'डबल प्ले', 'वाइल्ड पिच', 'निर्णायक आरबीआई', 'पिकऑफ आउट', 'बेस पर आउट', 'पास्ड बॉल', 'बॉक', 'रिलीफ पिचर'],
  tr: ['Gol', 'Asist', 'Sarı kart', 'Kırmızı kart', 'Başlangıç atıcısı', 'Home run', 'Çift', 'Üçlü', 'Hata', 'Üs çalma', 'Üs çalma başarısız', 'Çifte oyun', 'Wild pitch', 'Belirleyici sayı', 'Pickoff out', 'Üslerde out', 'Passed ball', 'Balk', 'Yedek atıcı'],
  nl: ['Doelpunt', 'Assist', 'Gele kaart', 'Rode kaart', 'Startende werper', 'Homerun', 'Double', 'Triple', 'Fout', 'Honk gestolen', 'Gepakt bij stelen', 'Double play', 'Wild pitch', 'Beslissende RBI', 'Uit door pickoff', 'Uit op de honken', 'Passed ball', 'Balk', 'Relief-werper'],
};
// 농구: pts, reb, ast, stl, blk — 숫자 뒤에 붙는 단위(점/리바운드/어시스트/스틸/블록)
const BK = {
  ko: ['점', '리바운드', '어시스트', '스틸', '블록'],
  en: ['pts', 'reb', 'ast', 'stl', 'blk'],
  ja: ['点', 'リバウンド', 'アシスト', 'スティール', 'ブロック'],
  es: ['pts', 'rebotes', 'asist.', 'robos', 'tapones'],
  pt: ['pts', 'rebotes', 'assist.', 'roubos', 'tocos'],
  fr: ['pts', 'rebonds', 'passes', 'interceptions', 'contres'],
  de: ['Pkt', 'Rebounds', 'Assists', 'Steals', 'Blocks'],
  it: ['pt', 'rimbalzi', 'assist', 'palle rubate', 'stoppate'],
  ru: ['очк.', 'подб.', 'передач', 'перехв.', 'блок-шот.'],
  ar: ['نقطة', 'ريباوند', 'تمريرة', 'سرقة', 'صد'],
  id: ['poin', 'rebound', 'assist', 'steal', 'blok'],
  th: ['แต้ม', 'รีบาวด์', 'แอสซิสต์', 'สตีล', 'บล็อก'],
  vi: ['điểm', 'rebound', 'kiến tạo', 'cướp bóng', 'chặn bóng'],
  'zh-Hans': ['分', '篮板', '助攻', '抢断', '盖帽'],
  'zh-Hant': ['分', '籃板', '助攻', '抄截', '阻攻'],
  hi: ['अंक', 'रिबाउंड', 'असिस्ट', 'स्टील', 'ब्लॉक'],
  tr: ['sayı', 'ribaund', 'asist', 'top çalma', 'blok'],
  nl: ['pnt', 'rebounds', 'assists', 'steals', 'blokken'],
};
const MIN = { ko: (m) => ` (${m}분)`, ja: (m) => ` (${m}分)`, 'zh-Hans': (m) => ` (${m}分钟)`, 'zh-Hant': (m) => ` (${m}分鐘)` };

const label = (lang, key) => L[lang][KEYS.indexOf(key)];
export const eventLabel = (lang, how, fallbackKey) => {
  const k = fallbackKey || HOW[how];
  return k ? label(lang, k) : how;
};
export const minuteLabel = (lang, m) => (typeof m === 'number' ? (MIN[lang] || ((x) => ` (${x}')`))(m) : '');

export function localTeam(lang, name) {
  if (!name || lang === 'ko') return name;
  return TEAM_EN[name] || name;
}
export function localPlayer(lang, name, pid) {
  if (lang === 'ko') return name;
  return PLAYER_I18N[pid]?.[lang] || PLAYER_EN[name] || name;
}
export function localLeague(lang, league) {
  if (!league) return league;
  return LEAGUE[lang]?.[league.toLowerCase()] || LEAGUE.en?.[league.toLowerCase()] || league;
}
export function bkStats(lang, p) {
  const u = BK[lang];
  return [`${p.pts ?? 0} ${u[0]}`, p.reb ? `${p.reb} ${u[1]}` : '', p.ast ? `${p.ast} ${u[2]}` : '', p.stl >= 3 ? `${p.stl} ${u[3]}` : '', p.blk >= 3 ? `${p.blk} ${u[4]}` : ''].filter(Boolean).join(lang === 'ko' ? ' ' : ', ');
}
