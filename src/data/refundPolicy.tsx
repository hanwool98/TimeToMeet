export const refundPolicyLines = [
  '행사 8일 전까지: 100% 환불',
  '행사 4~7일 전: 50% 환불',
  '행사 3일 전부터 당일: 환불 불가',
];

export function RefundPolicyBox() {
  return (
    <div className="rounded-[22px] bg-meet-blueSoft p-4 text-[14px] font-extrabold leading-relaxed text-[#555]">
      {refundPolicyLines.map((line) => (
        <p key={line}>{line}</p>
      ))}
    </div>
  );
}
