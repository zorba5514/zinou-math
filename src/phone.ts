// أرقام الهاتف الجزائرية: تُحفظ دائمًا بصيغة واحدة مثل 0555123456،
// مهما كتبها الولي (بفراغات، أو بـ +213، أو بأرقام عربية).

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

function westernDigits(text: string): string {
  return text.replace(/[٠-٩۰-۹]/g, (d) => {
    const i = ARABIC_DIGITS.indexOf(d);
    return String(i >= 0 ? i : PERSIAN_DIGITS.indexOf(d));
  });
}

/** يُرجع الرقم بصيغة 0XXXXXXXXX، أو null إن لم يكن رقم هاتف نقال جزائريًا صحيحًا. */
export function normalizePhone(input: string): string | null {
  let digits = westernDigits(input).replace(/[\s\-().]/g, "");
  if (digits.startsWith("+213")) digits = "0" + digits.slice(4);
  else if (digits.startsWith("00213")) digits = "0" + digits.slice(5);
  else if (digits.startsWith("213") && digits.length === 12) digits = "0" + digits.slice(3);
  return /^0[567]\d{8}$/.test(digits) ? digits : null;
}

/** للعرض: 0555 12 34 56 */
export function formatPhone(phone: string): string {
  return phone.length === 10 ? `${phone.slice(0, 4)} ${phone.slice(4, 6)} ${phone.slice(6, 8)} ${phone.slice(8)}` : phone;
}

/** الرقم الدولي لرابط واتساب: 213555123456 */
export function whatsappNumber(phone: string): string {
  return "213" + phone.slice(1);
}
