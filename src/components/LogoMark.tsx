type LogoMarkProps = {
  className?: string;
  imageClassName?: string;
};

export default function LogoMark({ className = '', imageClassName = '' }: LogoMarkProps) {
  return (
    <img
      alt="타임투밋 로고"
      className={`${className} ${imageClassName}`}
      src="/assets/time2meet-app-logo.png"
    />
  );
}
