const host = document.querySelector<HTMLElement>('#app')

if (!host) {
  throw new Error('게임을 표시할 #app 요소를 찾을 수 없습니다.')
}

// The UI module will take ownership of this mount point during integration.
host.textContent = document.title
