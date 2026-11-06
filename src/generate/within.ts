// within is p's answer, or undefined when ms pass first; the timer is cleared once p settles.
export async function within<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([p, new Promise<undefined>(r => { timer = setTimeout(() => r(undefined), ms); })]);
  } finally {
    clearTimeout(timer);
  }
}
